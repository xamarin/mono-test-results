/// <reference path="../typings/tsd.d.ts" />
/// <reference path="./helper.ts" />

/*
 * This file is responsible for downloading data from all lanes, cacheing
 * successfully downloaded data, and passing results to a Build subclass.
 */

const max_build_queries = 10

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
	["Linux 64-bit",   "test-mono-mainline/label=debian-amd64", "test-mono-pull-request-amd64"],
	["Linux 32-bit",   "test-mono-mainline/label=debian-i386",  "test-mono-pull-request-i386"],
	["Mac 32-bit",     "test-mono-mainline/label=osx-i386",     null],
	["Android",        "test-mono-mainline/label=debian-armel", "test-mono-pull-request-armel"],
	["Linux ARM",      "test-mono-mainline/label=debian-armhf", "test-mono-pull-request-armhf"],
	["Windows 32-bit", "z/label=w32",                           "w"]
]

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
	babysitterSource: string // If we downloaded the babysitter script, where from?

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
	interpretBabysitter(jsons: any[]) { }
	interpretMetadata(json) { }
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
	name: string       // Human-readable
	tag: string        // URL component
	displayUrl: string // Link to human-readable info page for build
	apiUrl: string     // Link to url JSON was loaded from
	status: Status
	builds: B[]
	buildsRemaining: number // Count of builds not yet finished loading
	buildConstructor: BuildClass<B>

	constructor(buildConstructor: BuildClass<B>, name:string, laneName:string) {
		this.name = name
		this.tag = laneName
		this.displayUrl = jenkinsBaseUrl(laneName)
		this.apiUrl = jenkinsLaneUrl(laneName)
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

			this.buildsRemaining = Math.min(laneResult.builds.length, max_build_queries)
			for (let buildInfo of laneResult.builds) {
				let build = new this.buildConstructor(this.tag, buildInfo.number)
				this.builds.push(build)

				let fetchData = (tag:string,    // Tag for cache
								 url:string,    // URL to load
								 status:Status, // Status variable to effect
								 success:(result:string)=>boolean, // Return true if data good enough to store
								 failure:()=>boolean = ()=>true    // Return true if failure is "real" (false to recover)
								) => {
					let storageKey = "cache!" + build.id + "!" + tag
					let storageValue = localStorage.getItem(storageKey)

					if (storageValue) {
						status.loaded = true
						success(storageValue) // Ignore result, value already stored
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
							localStorageSetItem(storageKey, fetchResult)
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

						// If metadata received and build is finished, go on to fetch babysitter report
						if (build.complete) {
							fetchData("babysitter", jenkinsBabysitterUrl(this.tag, build.id), build.babysitterStatus,
								(result:string) => {
									build.babysitterSource = "Azure"
									build.interpretBabysitter(jsonLines(result))
									this.buildsRemaining-- // Got a babysitter report, processing done
									return true
								},

								// Babysitter report failed, but don't trust it-- check old URL also
								() => {
									fetchData("babysitterLegacy", jenkinsBabysitterLegacyUrl(this.tag, build.id), build.babysitterStatus,
										(result:string) => {
											build.babysitterSource = "Jenkins"
											build.interpretBabysitter(jsonLines(result))
											this.buildsRemaining-- // Got a babysitter report, processing done
											return true
										},
										() => {
											this.buildsRemaining-- // Giving up. Processing done
											return true
										}
									)

									return false // Not really a failure
								}
							)
						} else {
							this.buildsRemaining-- // Won't be checking for babysitter report. Processing done
						}

						return build.complete
					}
				)

				queries++
				if (queries >= max_build_queries)
					break
			}

			invalidateUi()
		}).fail(() => {
            console.log("Failed to load url for lane", this.apiUrl);
			this.status.failed = true
			invalidateUi()
		})
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
				let lane = new Lane(b, name, laneName)
				lanes.push(lane)
				lane.load()
			}
		}
	}

	return lanes
}
