/// <reference path="../typings/tsd.d.ts" />
/// <reference path="./helper.ts" />

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

function jenkinsBabysitterUrl(lane:string, id:string) {
	return jenkinsBuildBaseUrl(lane, id) + "/artifact/babysitter_report.json_lines"
}

function jenkinsBabysitterAzureUrl(lane:string, id:string) {
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

// Represent one build+test run within a lane
class BuildBase {
	id: string
	babysitterStatus: Status
	metadataStatus: Status
	displayUrl: string

	constructor(laneTag: string, id: string) {
		this.id = id
		this.babysitterStatus = new Status()
		this.metadataStatus = new Status()
		this.displayUrl = jenkinsBuildBaseUrl(laneTag, id)
	}

	loaded() {
		return this.babysitterStatus.loaded && this.metadataStatus.loaded
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
	name: string  // Human-readable
	tag: string   // URL component
	displayUrl: string
	apiUrl: string
	status: Status
	builds: B[]
	buildsRemaining: number
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

				let fetchData = (tag:string, url:string, status:Status, success:(result:string)=>void) => {
					let storageKey = "cache!" + build.id + "!" + tag
					let storageValue = localStorage.getItem(storageKey)

					if (storageValue) {
						status.loaded = true
						success(storageValue)
						return
					}

					if ('debug' in options) console.log("build", build.id, "for lane", this.name, "loading", tag, "url", url)

					// Notice this fetches *text*
					$.get(url, fetchResult => {
						if ('debug' in options) console.log("build loaded url", url, "result length:", fetchResult.length)

						status.loaded = true
						try {
							success(fetchResult)
						} catch (e) {
							console.log("Failed to interpret result of url:", url, "exception:", e)
							status.failed = true
						}

						invalidateUi()
						if (!status.failed)
							localStorageSetItem(storageKey, fetchResult)
						this.buildsRemaining--
					}, "text").fail(() => {
						console.log("Failed to load url for lane", url);

						status.loaded = true
						status.failed = true
						this.buildsRemaining--
					})
				}

				fetchData("babysitter", jenkinsBabysitterAzureUrl(this.tag, build.id), build.babysitterStatus,
					(result:string) => {
						build.interpretBabysitter(jsonLines(result))
					}
				)

				fetchData("metadata", jenkinsBuildUrl(this.tag, build.id), build.metadataStatus,
					(result:string) => {
						build.interpretMetadata(JSON.parse(result))
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
