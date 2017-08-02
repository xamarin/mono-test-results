/// <reference path="./helper.ts" />

/*
 * This file is responsible for downloading data from all lanes, cacheing
 * successfully downloaded data, and passing results to a Build subclass.
 */

// Constants

const defaultMaxBuildQueries = 50
const maxCacheSize = 5000000 - 1024 // Limit 10 MB minus some headroom
const cachePrefix = "cache!"

const localStorageVersion = "1"
const localStorageCompressMode = "LZString"

const today = new Date()
const lastWeek = new Date()
lastWeek.setDate(today.getDate() - 7)

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
function jenkinsLaneUrl(jobName:string, platformName:string) {
	let url = "https://monobi.azurewebsites.net/api/Get?jobName=" + jobName
	if (platformName !== "")
		url += "&platformName=" + platformName
	url += "&laterThan=" + lastWeek.getFullYear() + "-" + (lastWeek.getMonth() + 1) + "-" + lastWeek.getDate()
	return url
}

// Get common prefix for human-readable and API data versions of one build
function jenkinsBuildBaseUrl(lane:string, id:string) {
	return jenkinsBaseUrl(lane) + "/" + id
}

// Get API query URL for build metadata (useful keys only)
function jenkinsBuildUrl(lane:string, id:string) {
	return jenkinsBuildBaseUrl(lane, id) + "/api/json?tree=actions[individualBlobs[*],parameters[*],lastBuiltRevision[*],remoteUrls[*]],timestamp,building,result"
}

function jenkinsBuildUrlWithJobName(jobName:string, platformName: string, id:string) {
	let url = "https://jenkins.mono-project.com/job/" + jobName
	if (platformName !== "")
		url += "/label=" + platformName
	url += "/" + id
	url += "/api/json?tree=actions[individualBlobs[*],parameters[*],lastBuiltRevision[*],remoteUrls[*]],timestamp,building,result"
	return url
}

// Lanes which build on every commit and are visible in "Build Logs" page
let jenkinsLaneDetails = [
	{name: "Mac Intel64",     val: [["test-mono-mainline", "osx-amd64"],    		   ["test-mono-pull-request-amd64-osx", ""]]},
	{name: "Mac Intel32",     val: [["test-mono-mainline", "osx-i386"],    			   ["test-mono-pull-request-i386-osx", ""]]},
	{name: "Linux Intel64",   val: [["test-mono-mainline-linux", "ubuntu-1404-amd64"], ["test-mono-pull-request-amd64", ""]]},
	{name: "Linux Intel32",   val: [["test-mono-mainline-linux", "ubuntu-1404-i386"],  ["test-mono-pull-request-i386", ""]]},
	{name: "Linux ARM64",     val: [["test-mono-mainline-linux", "debian-8-arm64"],    ["test-mono-pull-request-arm64", ""]]},
	{name: "Linux ARM32-hf",  val: [["test-mono-mainline-linux", "debian-8-armhf"],    ["test-mono-pull-request-armhf", ""]]},
	{name: "Linux ARM32-el",  val: [["test-mono-mainline-linux", "debian-8-armel"],    ["test-mono-pull-request-armel", ""]]},
	{name: "Windows Intel32", val: [["z", "w32"],                                      ["w", ""]]},
	{name: "Windows Intel64", val: [["z", "w64"],                                      ["x", ""]]}
]

// Lanes which are visible in "Build Logs (Special Configurations)" and status pages
// Notes:
// The "Coop" lanes are partial checked builds (no metadata check)
let jenkinsLaneDetailsPlus = [
	{name: "Linux Intel64 MCS",        val: [["test-mono-mainline-mcs", "ubuntu-1404-amd64",     "test-mono-pull-request-amd64-mcs"]]},
	{name: "Linux Intel64 Checked",    val: [["test-mono-mainline-checked", "ubuntu-1404-amd64"]]},
	{name: "Linux Intel32 Coop",       val: [["test-mono-mainline-coop", "ubuntu-1404-i386"]]},
	{name: "Linux Intel64 Coop",       val: [["test-mono-mainline-coop", "ubuntu-1404-amd64"]]},
	{name: "Linux Intel64 FullAOT",    val: [["test-mono-mainline-fullaot", "ubuntu-1404-amd64", "test-mono-pull-request-amd64-fullaot"]]},
	{name: "Linux ARM64 FullAOT",      val: [["test-mono-mainline-fullaot", "debian-8-arm64"]]},
	{name: "Linux ARM32-hf FullAOT",   val: [["test-mono-mainline-fullaot", "debian-8-armhf"]]},
	{name: "Linux ARM32-el FullAOT",   val: [["test-mono-mainline-fullaot", "debian-8-armel"]]},
	{name: "Linux Intel64 HybridAOT",  val: [["test-mono-mainline-hybridaot", "ubuntu-1404-amd64"]]},
	{name: "Linux Intel64 Bitcode",    val: [["test-mono-mainline-bitcode", "ubuntu-1404-amd64"]]}
]


// Lanes visible in "Build Logs (Special Configurations)" but omitted from status page
let jenkinsLaneDetailsPlusValgrind = [
	{name: "Linux Intel64 Bitcode Valgrind", val: [["test-mono-mainline-bitcode-valgrind", "ubuntu-1404-amd64"]]}
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

	constructor(idx:number, buildConstructor: BuildClass<B>, name:string, laneName: string, jobName:string, platformName:string, isPr:boolean, isCore:boolean) {
		this.idx = idx
		this.name = name
		this.tag = laneName
		this.displayUrl = jenkinsBaseUrl(laneName)
		this.apiUrl = jenkinsLaneUrl(jobName, platformName)
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

			// Fetch up to a number of builds chosen to be a week's worth of data

			// For each build in the Jenkins JSON
			for (let buildInfo of laneResult) {

				let build = new this.buildConstructor(this.tag, buildInfo.Id.toString())

				build.interpretMetadata(buildInfo)
				build.metadataStatus.loaded = true
				build.babysitterStatus.loaded = true

				build.interpretBabysitter(buildInfo)

				this.buildMap[buildInfo.Id] = build
			}

			invalidateUi()
		}).fail(() => {
            console.warn("Failed to load url for lane", this.apiUrl)
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
	function make(specs:object[], isCore:boolean) {
		for (let spec of specs) {

			let name = spec["name"]

			let columns = allowPr ? 2 : 1


			for (let d = 0; d < columns; d++) {
				if (d)
					name += " (PR)"
				let jobName = spec["val"][d][0]
				let platformName = spec["val"][d][1]

				let laneName = jobName
				if (platformName !== "")
					laneName += "/label=" + platformName
				if (laneName) {
					let lane = new Lane(lanes.length, b, name, laneName, jobName, platformName, !!d, isCore)
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
		make(jenkinsLaneDetails, true)

		if (laneVisibilityLevel >= 2)
			make(jenkinsLaneDetailsPlus, false)
		if (laneVisibilityLevel >= 3)
			make(jenkinsLaneDetailsPlusValgrind, false)
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

	interpretMetadata(data) {
		this.date = new Date(data.DateTime)
		this.result = data.Result.trim().toUpperCase()
		this.building = false
		this.gitHash = data.GitHash
		if (data.PrId !== -1 && data.PrTitle !== null && data.PrAuthor !== null) {
			this.pr = data.PrId
			this.prTitle = data.PrTitle
			this.prAuthor = data.PrAuthor
		}
		this.babysitterBlobUrl = data.BabysitterUrl
		this.complete = true

		let prHash:string = null
		let gitHash:string = null

		if (this.gitHash == null) {

			let metaUrl = jenkinsBuildUrlWithJobName(data.JobName, data.PlatformName, data.Id)

			$.ajax({
				url: metaUrl,
				success: function (fetchResult) {

					if (fetchResult.actions && fetchResult.actions.length) {
						for (let action of fetchResult.actions) {
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
				},
				async: false
			})
		}

		if (this.gitHash == null) {
			// In a PR branch, the ghprbActualCommit represents the commit that triggered the build,
			// and the last built revision is some temporary thing that half the time isn't even reported.
			this.gitHash = prHash ? prHash : gitHash
		}
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
