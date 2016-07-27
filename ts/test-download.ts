/// <reference path="../typings/tsd.d.ts" />
/// <reference path="./helper.ts" />

/*
 * This file is responsible for downloading data from all lanes, cacheing
 * successfully downloaded data, and passing results to a Build subclass.
 */

// Constants

const maxBuildQueries = 50
const maxCacheSize = 5000000 // Limit 5 MB
const cachePrefix = "cache!"

const localStorageVersion = "0"
const localStorageCompressMode = "LZString"

// Types

declare var LZString:any
declare var PriorityQueue:any

// Cache management

if (localStorageGetItem("version") != localStorageVersion) {
	console.log("First boot with this version, clearing localStorage")
	localStorageClear()
	localStorageSetItem("version", localStorageVersion)
	localStorageSetItem("compressMode", localStorageCompressMode)
} else if (localStorageGetItem("compressMode") != localStorageCompressMode) {
	console.log("First boot with this compression mode, clearing cache")
	localStorageClear(cachePrefix)
	localStorageSetItem("compressMode", localStorageCompressMode)
}

class DeletionQueueItem {
	date: number
	id: string

	constructor(date: number, id: string) {
		this.date = date
		this.id = id
	}
}

let deletionQueue = new PriorityQueue( (a,b) => b.date - a.date )

function deletionQueueEnq(date:number, id:string) {
	deletionQueue.enq(new DeletionQueueItem(date, id))
}

function deletionQueueRegister(date:number, id:string) {
	localStorageSetItem(cachePrefix + id + "!timestamp", String(date))
	deletionQueueEnq(date, id)
}

function localStorageWhittle(downTo: number) {
	while (localStorageUsage() > downTo) {
		let target:string
		try {
			target = deletionQueue.deq().id
		} catch (_) { // throws Error on queue empty
			console.log("Warning: local storage usage exceeds limit, but no clearable data")
			return
		}

		localStorageClear(cachePrefix + target)

		// PRs will tend to consist of several builds w/ same ID and timestamp.
		while((<DeletionQueueItem>deletionQueue.peek()).id == target)
			deletionQueue.deq()

		console.log("Clearing space in localstorage cache: Forgot build", target, "local storage now", localStorageUsage())
	}
}

// Build deletion queue from initial cache contents
{
	let isTimestamp = new RegExp(localStoragePrefix + cachePrefix + "(\\d+)!timestamp")
	for (let i = 0; i < localStorage.length; i++) {
		let key = localStorage.key(i)
		let match = isTimestamp.exec(key)
		if (!match)
			continue
		let id = match[1]
		let date = +localStorage.getItem(key)
		deletionQueueEnq(date, id)
	}
}

// Lanes list

function jenkinsBaseUrl(lane:string) {
	return "https://jenkins.mono-project.com/job/" + lane
}

function jenkinsLaneUrl(lane:string) {
	return jenkinsBaseUrl(lane) + "/api/json"
}

function jenkinsBuildBaseUrl(lane:string, id:string) {
	return jenkinsBaseUrl(lane) + "/" + id
}

function jenkinsBuildUrl(lane:string, id:string) {
	return jenkinsBuildBaseUrl(lane, id) + "/api/json?tree=actions[individualBlobs[*],parameters[*]],timestamp,result"
}

function jenkinsBabysitterLegacyUrl(lane:string, id:string) {
	return jenkinsBuildBaseUrl(lane, id) + "/artifact/babysitter_report.json_lines"
}

function jenkinsBabysitterUrl(lane:string, id:string) {
	return jenkinsBuildBaseUrl(lane, id) + "/Azure/processDownloadRequest" + "/" + lane + "/" + id + "/babysitter_report.json_lines"
}

let jenkinsLaneSpecs = [ // Name, Regular Jenkins job, PR Jenkins job
	["Mac Intel64",     "test-mono-mainline/label=osx-amd64",               "test-mono-pull-request-amd64-osx"],
	["Mac Intel32",     "test-mono-mainline/label=osx-i386",                "test-mono-pull-request-i386-osx"],
	["Linux Intel64",   "test-mono-mainline-linux/label=ubuntu-1404-amd64", "test-mono-pull-request-amd64"],
	["Linux Intel32",   "test-mono-mainline-linux/label=ubuntu-1404-i386",  "test-mono-pull-request-i386"],
	["Linux ARM64",     "test-mono-mainline-linux/label=debian-8-arm64",    "test-mono-pull-request-arm64"],
	["Linux ARM32-hf",  "test-mono-mainline-linux/label=debian-8-armhf",    "test-mono-pull-request-armhf"],
	["Linux ARM32-el",  "test-mono-mainline-linux/label=debian-8-armel",    "test-mono-pull-request-armel"],

    // Windows builds do not currently run babysitter script.
//	["Windows Intel32", "z/label=w32",                                      "w"],
//	["Windows Intel64", "z/label=w64",                                      "x"]
]

// Download support

class Status {
	loaded: boolean
	failed: boolean // If failed is true loaded should also be true

	constructor() { this.loaded = false; this.failed = false }
}

// Represent one build+test run within a lane.
// Subclasses receive server data as parsed JSON and decide what to do with it.
class BuildBase {
	id: string               // Build number
	metadataStatus: Status
	babysitterStatus: Status
	displayUrl: string       // Link to human-readable info page for build
	complete: boolean        // If false, build is ongoing

	constructor(laneTag: string, id: string) {
		this.id = id
		this.metadataStatus = new Status()
		this.babysitterStatus = new Status()
		this.displayUrl = jenkinsBuildBaseUrl(laneTag, id)
	}

	loaded() { // Note: Babysitter load is not attempted unless metadata results say to
		return this.metadataStatus.loaded &&
			(this.metadataStatus.failed || !this.complete || this.babysitterStatus.loaded)
	}

	failed() {
		return this.babysitterStatus.failed || this.metadataStatus.failed
	}

	// Subclasses should overload these to parse out the data they need
	interpretMetadata(json) { }
	interpretBabysitter(jsons: any[]) { }
}

// The type of the class object for a class that inherits from BuildBase
interface BuildClass<B extends BuildBase> {
	new(laneTag: string, id: string): B
}

// Represents a lane (a Jenkins "job") and its builds
// Takes a custom Build class
// TODO:
// - Fetch jobs list from Lane url
// - Fetch URL like https://jenkins.mono-project.com/job/test-mono-mainline/label=debian-amd64/3063/artifact/babysitter_report.json_lines
//   from job number
class Lane<B extends BuildBase> {
	idx: number        // Index in lanes array
	name: string       // Human-readable
	tag: string        // URL component
	displayUrl: string // Link to human-readable info page for build
	apiUrl: string     // Link to url JSON was loaded from
	isPr: boolean
	status: Status
	builds: B[]
	buildsRemaining: number // Count of builds not yet finished loading
	buildConstructor: BuildClass<B>

	constructor(idx:number, buildConstructor: BuildClass<B>, name:string, laneName:string, isPr:boolean) {
		this.idx = idx
		this.name = name
		this.tag = laneName
		this.displayUrl = jenkinsBaseUrl(laneName)
		this.apiUrl = jenkinsLaneUrl(laneName)
		this.isPr = isPr
		this.status = new Status()
		this.builds = []
		this.buildsRemaining = 0
		this.buildConstructor = buildConstructor
	}

	load() {
		if ('debug' in options) console.log("lane loading url", this.apiUrl)
		$.get(this.apiUrl, laneResult => {
			this.status.loaded = true
			if ('debug' in options) console.log("lane loaded url", this.apiUrl, "result:", laneResult)
			let queries = 0

			this.buildsRemaining = Math.min(laneResult.builds.length, maxBuildQueries)
			for (let buildInfo of laneResult.builds) {
				let build = new this.buildConstructor(this.tag, buildInfo.number)
				this.builds.push(build)
				let buildTag = build.id + "!" + this.tag

				let fetchData = (tag:string,    // Tag for cache
								 url:string,    // URL to load
								 status:Status, // Status variable to effect
								 success:(result:string)=>boolean, // Return true if data good enough to store
								 failure:()=>boolean = ()=>true    // Return true if failure is "real" (false to recover)
								) => {
					let storageKey = cachePrefix + buildTag + "!" + tag
					let storageValue = localStorageGetItem(storageKey)

					if (storageValue) {
						status.loaded = true
						success(LZString.decompress(storageValue)) // Ignore result, value already stored
						invalidateUi()
						return
					}

					if ('debug' in options) console.log("build", build.id, "for lane", this.name, "loading", tag, "url", url)

					// Notice this fetches *text*
					$.get(url, fetchResult => {
						if ('debug' in options) console.log("build loaded url", url, "result length:", fetchResult.length)

						let mayStore = false
						status.loaded = true
						try {
							mayStore = success(fetchResult)
						} catch (e) {
							console.log("Failed to interpret result of url:", url, "exception:", e)
							status.failed = true
						}

						invalidateUi()
						if (!status.failed && mayStore)
							localStorageSetItem(storageKey, LZString.compress(fetchResult))
					}, "text").fail(() => {
						console.log("Failed to load url for lane", url);

						if (failure()) {
							status.loaded = true
							status.failed = true
							invalidateUi()
						}
					})
				}

				// Fetch metadata
				fetchData("metadata", jenkinsBuildUrl(this.tag, build.id), build.metadataStatus,
					(result:string) => {
						let json = JSON.parse(result)
						build.complete = !!json.result
						build.interpretMetadata(json)

						// If metadata received and build is finished,
						if (build.complete) {
							let timestamp = json.timestamp

							// Manage cache size
							localStorageWhittle(maxCacheSize - result.length)
							deletionQueueRegister(timestamp, buildTag)

							// Fetch babysitter report
							fetchData("babysitter", jenkinsBabysitterUrl(this.tag, build.id), build.babysitterStatus,
								(result:string) => {
									build.interpretBabysitter(jsonLines(result))
									this.buildsRemaining-- // Got a babysitter report, processing done
									return true
								},

								// No babysitter report
								() => {
									this.buildsRemaining-- // Giving up. Processing done
									return true
								}
							)
						} else {
							this.buildsRemaining-- // Won't be checking for babysitter report. Processing done
						}

						return build.complete
					}
				)

				queries++
				if (queries >= maxBuildQueries)
					break
			}

			invalidateUi()
		}).fail(() => {
            console.log("Failed to load url for lane", this.apiUrl);
			this.status.failed = true
			invalidateUi()
		})
	}

	loaded() {
		return this.status.loaded || this.status.failed
	}
}

function makeLanes<B extends BuildBase>(b: BuildClass<B>) {
	// Construct lanes
	let lanes: Lane<B>[] = []

	for (let spec of jenkinsLaneSpecs) {
		// Spec is a triplet of name, normal URL tag, PR URL tag
		for (let d = 0; d < 2; d++) {
			let name = spec[0]
			if (d)
				name += " (PR)"
			let laneName = spec[d+1]
			if (laneName) {
				let lane = new Lane(lanes.length, b, name, laneName, !!d)
				lanes.push(lane)
				lane.load()
			}
		}
	}

	return lanes
}
