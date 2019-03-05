/// <reference path="./helper.ts" />

/*
 * This file is responsible for downloading data from all lanes, cacheing
 * successfully downloaded data, and passing results to a Build subclass.
 */

// Constants

const defaultMaxBuildQueries = 500
const maxCacheSize = 5000000 - 1024 // Limit 50 MB minus some headroom
const cachePrefix = "cache!"

const localStorageVersion = "2"
const localStorageCompressMode = "LZString"

// May be overloaded in HTML file
declare var overloadMaxBuildQueries : number
const maxBuildQueries = typeof overloadMaxBuildQueries !== 'undefined' ? overloadMaxBuildQueries : defaultMaxBuildQueries
declare var overloadAllowPR : boolean
const allowPr = typeof overloadAllowPR !== 'undefined' ? overloadAllowPR : true
declare var overloadFetchBabysitter : boolean
const fetchBabysitter = typeof overloadFetchBabysitter !== 'undefined' ? overloadFetchBabysitter : true
declare var overloadLaneVisibilityLevel : number
const laneVisibilityLevel = typeof overloadLaneVisibilityLevel !== 'undefined' ? overloadLaneVisibilityLevel : 1
declare var overloadLaneContents : string[][]
const haveOverloadLaneContents = typeof overloadLaneContents !== 'undefined'

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

// The cache consists of:
// For each build tag (build id+lane key) there is a series of cache items, one of which is always a "timestamp".
// The deletion queue is a timestamp-sorted heap of build tags (so that)
// The deletion index is a lookup table for mapping build tags to the subkeys for that tag's cache items (so they can be quickly found and deleted).
// TODO: If we could switch to IndexedDB, some of this could be done with built-in capabilities.

class DeletionQueueItem {
	constructor(public date: number, public buildTag: string) {}
}

let deletionQueue = new PriorityQueue( (a,b) => b.date - a.date )

// Add an item to the in-memory list of deletables.
function deletionQueueEnq(date:number, buildTag:string) {
	deletionQueue.enq(new DeletionQueueItem(date, buildTag))
}

// Add an item to the in-memory and localstorage lists of deletables.
function deletionQueueRegister(date:number, buildTag:string) {
	let timestampKey = cachePrefix + buildTag + "!timestamp"
	if (!localStorage.getItem(timestampKey)) {
		localStorageSetItem(timestampKey, String(date))
		deletionQueueEnq(date, buildTag)
	}
}

let deletionIndex : { [buildTag:string] : string[] } = emptyObject()

// Add a subkey to the deletion index
function deletionIndexAdd(buildTag:string, kind:string) {
	if (!(buildTag in deletionIndex))
		deletionIndex[buildTag] = []
	deletionIndex[buildTag].push( kind )
}

// Target a build tag in the deletion index and delete it from localStorage
function deletionIndexClear(buildTag:string) {
	let kinds = deletionIndex[buildTag]
	if (kinds) {
		for (let kind of kinds) {
			localStorageClearOne(cachePrefix + buildTag + "!" + kind)
		}
        delete deletionIndex[buildTag]
	}
}

// Given a target localStorage usage size and a timestamp, delete items
// older than that timestamp until the target size is reached.
// Delete entire build tags (with all their subkeys) at a time.
function localStorageWhittle(downTo: number, date: number) {
	while (localStorageUsage() > downTo) {
		let target:DeletionQueueItem
		try {
			target = deletionQueue.peek()
		} catch (e) { // throws Error on queue empty
			console.warn("Warning: local storage usage is recorded at "+localStorageUsage()+", which must be lowered to "+downTo+" to make way for new data. However, the record must be wrong, because the clearable data list is empty (" + e + ")")
			return false
		}

		if (date <= target.date) { // FIXME: This is ridiculously unlikely, and if we hit it something else is probably wrong.
			if (hashHas('debug')) console.log("Tried to lower localstorage cache to goal "+downTo+", but the oldest item in the cache ("+target.date+") is no older than the replacement one ("+date+"), so cancelled.")
			return false
		}

		// Target is appropriate to delete
		deletionQueue.deq()
		deletionIndexClear(target.buildTag)

		if (hashHas('debug')) console.log("Clearing space in localstorage cache (goal "+downTo+"): Forgot build", target.buildTag, "local storage now", localStorageUsage())
	}

	return true
}

// Build initial deletion queue from initial cache contents
// TODO: Also load these items as lanes
{
	let parseCacheItem = new RegExp("^" + localStoragePrefix + cachePrefix + "(\\d+![^!]+)!([^!]+)$")
	for (let i = 0; i < localStorage.length; i++) {
		let key = localStorage.key(i)
		let match = parseCacheItem.exec(key)
		if (!match)
			continue
		let buildTag = match[1]
		let kind = match[2]
		deletionIndexAdd(buildTag, kind)
		if (kind == "timestamp") {
			let date = toNumber(localStorage.getItem(key))
			deletionQueueEnq(date, buildTag)
		}
	}
}

// Lanes list

// Construct URLs given data from lane specs

// Get common prefix for human-readable lane data, builds in that lane, and API queries for that lane
function jenkinsBaseUrl(lane:string) {
	return "https://jenkins.mono-project.com/job/" + lane
}

// Get API query URL for lane metadata
function jenkinsLaneUrl(lane:string) {
	return jenkinsBaseUrl(lane) + "/api/json"
}

// Get common prefix for human-readable and API data versions of one build
function jenkinsBuildBaseUrl(lane:string, id:string) {
	return jenkinsBaseUrl(lane) + "/" + id
}

// Get API query URL for build metadata (useful keys only)
function jenkinsBuildUrl(lane:string, id:string) {
	return jenkinsBuildBaseUrl(lane, id) + "/api/json?tree=actions[individualBlobs[*],parameters[*],lastBuiltRevision[*],remoteUrls[*]],timestamp,building,result"
}

// Lanes which build on every commit and are visible in "Build Logs" page
let jenkinsLaneSpecs = [ // Name, Regular Jenkins job, PR Jenkins job
	["OSX amd64",     "test-mono-mainline/label=osx-amd64",               "test-mono-pull-request-amd64-osx"],
	["OSX i386",     "test-mono-mainline/label=osx-i386",                "test-mono-pull-request-i386-osx"],
	["Linux amd64",   "test-mono-mainline-linux/label=debian-9-amd64",    "test-mono-pull-request-amd64"],
	["Linux i386",   "test-mono-mainline-linux/label=debian-9-i386",     "test-mono-pull-request-i386"],
	["Linux arm64",     "test-mono-mainline-linux/label=debian-9-arm64",    "test-mono-pull-request-arm64"],
	["Linux armhf",  "test-mono-mainline-linux/label=debian-9-armhf",    "test-mono-pull-request-armhf"],
	["Linux armel",  "test-mono-mainline-linux/label=debian-9-armel",    "test-mono-pull-request-armel"],
	["Windows i386", "z/label=w32",                                      "w"],
	["Windows amd64", "z/label=w64",                                      "x"]
]

// Lanes which are visible in "Build Logs (Special Configurations)" and status pages
// Notes:
// The "Coop" lanes are partial checked builds (no metadata check)
let jenkinsLaneSpecsPlus = [
	["Linux amd64 MCS",        "test-mono-mainline-mcs/label=debian-9-amd64",     "test-mono-pull-request-amd64-mcs"],
	["Linux amd64 Checked",    "test-mono-mainline-checked/label=debian-9-amd64"],
	["Linux i386 Coop",       "test-mono-mainline-linux-coop-suspend/label=debian-9-i386"],
	["Linux amd64 Coop",       "test-mono-mainline-linux-coop-suspend/label=debian-9-amd64"],
	["Linux amd64 FullAOT",    "test-mono-mainline-linux-fullaot/label=debian-9-amd64", "test-mono-pull-request-amd64-fullaot"],
	["Linux arm64 FullAOT",      "test-mono-mainline-linux-fullaot/label=debian-9-arm64"],
	["Linux armhf FullAOT",   "test-mono-mainline-linux-fullaot/label=debian-9-armhf"],
	["Linux armel FullAOT",   "test-mono-mainline-linux-fullaot/label=debian-9-armel"],
	["Linux amd64 HybridAOT",  "test-mono-mainline-linux-hybridaot/label=debian-9-amd64"],
	["Linux amd64 Bitcode",    "test-mono-mainline-linux-bitcode/label=debian-9-amd64"],
	["Linux amd64 Interpreter", "test-mono-interpreter/label=debian-9-amd64", "test-mono-pull-request-interpreter"],
	["Linux arm64 Interpreter", "test-mono-interpreter/label=debian-9-arm64", "test-mono-pull-request-interpreter-aarch64"],
	["Linux amd64 FullAOT+Interpreter", "test-mono-fullaot+interpreter/label=debian-9-amd64", "test-mono-pull-request-fullaot+interpreter"],
	["Linux arm64 FullAOT+Interpreter", "test-mono-fullaot+interpreter/label=debian-9-arm64", "test-mono-pull-request-arm64-fullaot+interpreter"],
	["Linux amd64 FullAOT+Interpreter+LLVM", "test-mono-mainline-linux-fullaot+interpreter+llvm/label=debian-9-amd64", "test-mono-pull-request-fullaot+interpreter+llvm"],
	["Linux arm64 FullAOT+Interpreter+LLVM", "test-mono-mainline-linux-fullaot+interpreter+llvm/label=debian-9-arm64", "test-mono-pull-request-arm64-fullaot+interpreter+llvm"],
	["Windows amd64 FullAOT", "zy/label=w64", "xy"]
]

// Lanes visible in "Build Logs (Special Configurations)" but omitted from status page
let jenkinsLaneSpecsPlusValgrind = [
	["Linux amd64 Bitcode Valgrind", "test-mono-mainline-linux-bitcode-valgrind/label=debian-9-amd64"]
]

// Repo we expect our hashes to correspond to (any entry acceptable)
let gitRepo = {
	"git://github.com/mono/mono.git": true,
	"https://github.com/mono/mono": true
}

// `remoteUrls` in the JSON contains a list of URLs, which in some lanes includes no-longer used historical URLs.
// We assume that if the main mono repo is in this list, this build is at least a BRANCH of mono and therefore good enough.
function gitRepoMatches(json:any) {
	for (let url of json) {
		if (url in gitRepo)
			return true
	}
	return false
}

// Download support

// Status of a single network resource we are trying to access
class Status {
	loaded: boolean
	failed: boolean // If failed is true loaded should also be true

	constructor() { this.loaded = false; this.failed = false }
}

// Represent one build+test run within a lane.
// Subclasses receive server data as parsed JSON and decide what to do with it.
class BuildBase {
	id: string               // Build number
	metadataStatus: Status   // Network status for Jenkins metadata access
	babysitterStatus: Status // Network status for babysitter log access
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
			(this.metadataStatus.failed || !fetchBabysitter
				|| !this.complete || this.babysitterStatus.loaded)
	}

	failed() {
		return this.babysitterStatus.failed || this.metadataStatus.failed
	}

	// Subclasses should overload these to parse out the data they need
	interpretMetadata(json) { }
	interpretBabysitter(jsons: any[]) { }
	babysitterUrl() : string { return null }
}

// The type of the class object for a class that inherits from BuildBase
interface BuildClass<B extends BuildBase> {
	new(laneTag: string, id: string): B
}

// Represents a lane (a Jenkins "job") and its builds
// Takes a custom Build class as template argument
class Lane<B extends BuildBase> {
	idx: number        // Index in lanes array
	name: string       // Human-readable
	tag: string        // URL component
	displayUrl: string // Link to human-readable info page for build
	apiUrl: string     // Link to url JSON was loaded from
	isPr: boolean
	isCore:boolean     // This lane is tested on every commit
	status: Status     // Network status for Jenkins information about lane
	everLoaded: boolean
	buildMap: { [key:string] : B } // Map build IDs to build objects
	buildsRemaining: number // Count of builds not yet finished loading
	buildConstructor: BuildClass<B> // Class object to use when instantiating a new build

	constructor(idx:number, buildConstructor: BuildClass<B>, name:string, laneName:string, isPr:boolean, isCore:boolean) {
		this.idx = idx
		this.name = name
		this.tag = laneName
		this.displayUrl = jenkinsBaseUrl(laneName)
		this.apiUrl = jenkinsLaneUrl(laneName)
		this.isPr = isPr
		this.isCore = isCore
		this.status = new Status()
		this.everLoaded = false
		this.buildMap = {}
		this.buildsRemaining = 0
		this.buildConstructor = buildConstructor
	}

	builds() { return objectValues(this.buildMap) }

	visible() { return this.status.loaded || this.everLoaded }

	// Call to download build list for lane and then download all build data not already downloaded
	load() {
		if (hashHas('debug')) console.log("lane loading url", this.apiUrl)

		// First network-fetch Jenkins data for the lane
		$.get(this.apiUrl, laneResult => {
			this.status.loaded = true
			this.everLoaded = true
			if (hashHas('debug')) console.log("lane loaded url", this.apiUrl, "result:", laneResult)
			let queries = 0

			// Fetch up to an arbitrary number of builds chosen to be "probably about a week's worth of data"
			// TODO: See if we can figure out a way to fetch a specific time range rather than just "some builds"?
			this.buildsRemaining = Math.min(laneResult.builds.length, maxBuildQueries)

			// For each build in the Jenkins JSON
			for (let buildInfo of laneResult.builds) {
				let buildId = String(buildInfo.number)
				let timestamp:number = null // FIXME: This variable stores shared mutable state for closures below. This is confusing and brittle.

				// This build is already in memory (apparently the reload button was hit). Processing done
				if (this.buildMap[buildId] && this.buildMap[buildId].complete) {
					this.buildsRemaining--

				// This build is new and its data needs to be downloaded.
				} else {
					let buildTag = buildId + "!" + this.tag
					let build = new this.buildConstructor(this.tag, buildId)

					// FetchData is an inner helper function that acquires a network resource and calls a callback with results.
					// It first queries the localStorage cache to see if the network resource is known. If not, it hits network.
					let fetchData = (tag:string,    // Tag for cache
									 url:string,    // URL to load
									 status:Status, // Status variable to effect
									 success:(result:string)=>boolean,     // Return true if data good enough to store
									 failure:(result)=>boolean = ()=>true  // Return true if failure is "real" (false to recover)
									                                       // (Note: Failure recovery is no longer used,
									                                       //        it was originally for checking alternate URLs)
									) => {
						let storageKey = cachePrefix + buildTag + "!" + tag // Key used in localStorage for this resource
						let storageValue = localStorageGetItem(storageKey)

						if (storageValue) { // This was downloaded already and cached in localstorage
							status.loaded = true
							success(LZString.decompress(storageValue)) // Ignore result, value already stored
							invalidateUi()
							return
						}

						if (hashHas('debug')) console.log("build", build.id, "for lane", this.name, "loading", tag, "url", url)

						// Network-fetch resource (Notice: Fetches *text*, not JSON)
						$.get(url, fetchResult => {
							if (hashHas('debug')) console.log("build loaded url", url, "result length:", fetchResult.length)

							let mayStore = false
							status.loaded = true
							try {
								// Data successfully loaded! Inform callback.
								// Callback decides whether data is "good enough" to store in localStorage cache
								mayStore = success(fetchResult)
							} catch (e) {
								console.warn("Failed to interpret result of url:", url, "exception:", e)
								status.failed = true
							}

							invalidateUi() // Assume successfully loading a network resource changes the UI

							// If downloaded data is deemed sensible enough to store in the cache, do so
							if (!status.failed && mayStore && timestamp != null) {
								let compressed = LZString.compress(fetchResult)

								// Ensure adequate space in local storage
								let spaceAvailable = localStorageWhittle(maxCacheSize - compressed.length, timestamp)

								// Write into local storage
								if (spaceAvailable)
									localStorageSetItem(storageKey, compressed)
							}
						}, "text").fail((xhr) => {
							console.warn("Failed to load url for lane", url, "error", xhr.status);

							// Inform callback of failure, let it decide whether to suppress error
							// FIXME: Remove this feature? It's not currently used
							if (failure(xhr.status)) {
								status.loaded = true
								status.failed = true
								invalidateUi()
							}
						})
					}

					// Fetch Jenkins build metadata
					fetchData("metadata", jenkinsBuildUrl(this.tag, build.id), build.metadataStatus,
						(result:string) => {
							let json = JSON.parse(result)
							build.complete = !json.building && !!json.result
							build.interpretMetadata(json)

							// Do this pretty late, so reloads look nice.
							this.buildMap[buildId] = build

							// If metadata received and build is finished,
							if (fetchBabysitter && build.complete) {
								timestamp = toNumber(json.timestamp) // In practice already a number, but make sure

								// Manage cache size
								deletionQueueRegister(timestamp, buildTag)

								// 404s (but not other failure modes) are treated as permanent and cached
								let babysitter404Key = cachePrefix + buildTag + "!babysitter404"
								let babysitterIs404 = localStorageGetItem(babysitter404Key)
								let babysitterUrl = babysitterIs404 ? null : build.babysitterUrl()
								if (!babysitterIs404 && babysitterUrl != null) {
									// Fetch babysitter report
									fetchData("babysitter", babysitterUrl, build.babysitterStatus,
										(result:string) => {
											build.interpretBabysitter(jsonLines(result))
											this.buildsRemaining-- // Got a babysitter report, processing done
											return true
										},

										// No babysitter report
										(status) => {
											if (+status == 404)
												localStorageSetItem(babysitter404Key, "1")

											this.buildsRemaining-- // Giving up. Processing done
											return true
										}
									)
								} else {
									this.buildsRemaining-- // Won't be checking for known-404'd babysitter report. Processing done
									build.babysitterStatus.loaded = true
									build.babysitterStatus.failed = true
								}
							} else {
								this.buildsRemaining-- // Build ongoing, won't be checking for babysitter report. Processing done

							}

							return build.complete // Only cache this result if the build is finished (ie data won't change in future)
						},

						// Couldn't load metadata, so perform deferred storage of build object and bail
						// FIXME: Should buildsRemaining be decremented here?
						(status) => {
							this.buildMap[buildId] = build
							return true
						}
					)
				}

				queries++
				if (queries >= maxBuildQueries)
					break
			}

			invalidateUi()
		}).fail(() => {
            console.warn("Failed to load url for lane", this.apiUrl);
			this.status.loaded = true
			this.status.failed = true
			invalidateUi()
		})
	}
}

// This is the "entry point" to the file; call with a custom BuildBase subclass to create and start downloading a lanes table.
function makeLanes<B extends BuildBase>(b: BuildClass<B>) {
	// Construct lanes
	let lanes: Lane<B>[] = []

	// Helper: Load contents of a "specs" table such as is seen at the top of this file
	function make(specs:string[][], isCore:boolean) {
		for (let spec of specs) {
			let name = spec[0]

			// Spec is a triplet of name, normal URL tag, PR URL tag
			let columns = allowPr ? 2 : 1 // Look at PR URL tag column?
			for (let d = 0; d < columns; d++) {
				if (d)
					name += " (PR)"
				let laneName = spec[d+1]
				if (laneName) {
					let lane = new Lane(lanes.length, b, name, laneName, !!d, isCore)
					lanes.push(lane)
					lane.load()
				}
			}
		}
	}

	// Which specs to load are determined by overloads set in HTML file
	if (haveOverloadLaneContents) {
		make(overloadLaneContents, false)
	} else {
		make(jenkinsLaneSpecs, true)

		if (laneVisibilityLevel >= 2)
			make(jenkinsLaneSpecsPlus, false)

		if (laneVisibilityLevel >= 3)
			make(jenkinsLaneSpecsPlusValgrind, false)
	}

	return lanes
}

// Build subclass which processes the Jenkins metadata (since this is used by both -status.tsx
// and -results.tsx) But not the babysitter data (-results.tsx has its own subclass for that)
class BuildStandard extends BuildBase {
	date: Date
	result: string
	building: boolean
	gitHash: string
	pr: string        // ID number
	prUrl: string
	prTitle: string
	prAuthor: string
	babysitterBlobUrl: string

	interpretMetadata(json) {
		this.date = new Date(+json.timestamp)
		this.result = json.result
		this.building = json.building

		let prHash:string = null
		let gitHash:string = null

		if (json.actions && json.actions.length) {
			for (let action of json.actions) {
				if (action._class == "hudson.model.ParametersAction" && action.parameters) {
					for (let param of action.parameters) {
						switch (param.name) {
							case "ghprbPullId":
								this.pr = param.value
								break
							case "ghprbPullLink":
								this.prUrl = param.value
								break
							case "ghprbPullTitle":
								this.prTitle = param.value
								break
							case "ghprbPullAuthorLogin":
								this.prAuthor = param.value
								break
							case "ghprbActualCommit":
								prHash = param.value
								break
							default: break
						}
					}
				} else if (action._class == "hudson.plugins.git.util.BuildData") {
					// There will be typically be one array entry for the standards suite repo and one array entry for the "real" git repo
					if (action.lastBuiltRevision && action.remoteUrls && gitRepoMatches(action.remoteUrls)) {
						gitHash = action.lastBuiltRevision.SHA1
					}
				} else if (action._class == "com.microsoftopentechnologies.windowsazurestorage.AzureBlobAction") {
					let blobs = action.individualBlobs
					if (blobs) {
						for (let blob of blobs) {
							let url = blob.blobURL
							if (endsWith(url, "babysitter_report.json_lines"))
								this.babysitterBlobUrl = url
						}
					}
				}
			}
		}

		// In a PR branch, the ghprbActualCommit represents the commit that triggered the build,
		// and the last built revision is some temporary thing that half the time isn't even reported.
		this.gitHash = prHash ? prHash : gitHash
	}

	inProgress() {
		return this.building || !this.result
	}

	resultString() {
		if (!this.result)
			return "(In progress)"
		if (this.inProgress())
			return "(Uploading)"
		return this.result
	}

	buildTag() {
		if (this.pr)
			return this.pr+this.gitHash
		if (this.gitHash)
			return this.gitHash
		return "INVALID" // Lane is misconfigured
	}

	gitDisplay() {
		return this.gitHash ? this.gitHash.slice(0,6) : "[UNKNOWN]"
	}

	gitUrl(allowPr=true) {
		if (allowPr && this.prUrl)
			return this.prUrl
		if (this.gitHash)
			return "https://github.com/mono/mono/commit/" + this.gitHash
		return "https://github.com/mono/mono" // Lane is misconfigured
	}

	babysitterUrl() {
		return this.babysitterBlobUrl
	}
}
