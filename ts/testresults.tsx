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

	constructor(id: string) {
		this.id = id
		this.babysitterStatus = new Status()
		this.metadataStatus = new Status()
	}

	loaded() {
		return this.babysitterStatus.loaded && this.metadataStatus.loaded
	}

	failed() {
		return this.babysitterStatus.failed || this.metadataStatus.failed
	}

	interpretBabysitter(jsons: any[]) { }

	interpretMetadata(json) { }
}

// Split this out in case it makes sense to make other classes later that extract different fields
class Build extends BuildBase {
	date: Date
	result: string

	constructor(id: string) {
		super(id)
	}

	interpretBabysitter(jsons: any[]) {
		console.log("Got babysitter", jsons)
	}

	interpretMetadata(json) {
		console.log("Got metadata", json)
		this.date = new Date(+json.timestamp)
		this.result = json.result ? json.result : "Success"
	}
}

// Represents a lane (a Jenkins "job") and its builds
// TODO:
// - Fetch jobs list from Lane url
// - Fetch URL like https://jenkins.mono-project.com/job/test-mono-mainline/label=debian-amd64/3063/artifact/babysitter_report.json_lines
//   from job number
class Lane {
	name: string  // Human-readable
	tag: string   // URL component
	url: string
	status: Status
	builds: Build[]
	buildsRemaining: number

	constructor(name:string, laneName:string) {
		this.name = name
		this.tag = laneName
		this.url = jenkinsLaneUrl(laneName)
		this.status = new Status()
		this.builds = []
		this.buildsRemaining = 0
	}

	load() {
		if ('debug' in options) console.log("lane loading url", this.url)
		$.get(this.url, laneResult => {
			this.status.loaded = true
			if ('debug' in options) console.log("lane loaded url", this.url, "result:", laneResult)
			let queries = 0

			this.buildsRemaining = laneResult.builds.length
			for (let buildInfo of laneResult.builds) {
				let build = new Build(buildInfo.number)
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

				fetchData("babysitter", jenkinsBabysitterUrl(this.tag, build.id), build.babysitterStatus,
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
            console.log("Failed to load url for lane", this.url);
			this.status.failed = true
			invalidateUi()
		})
	}
}

// Construct lanes
let lanes: Lane[] = []

for (let spec of jenkinsLaneSpecs) {
	// Spec is a triplet of name, normal URL tag, PR URL tag
	for (let d = 0; d < 2; d++) {
		let name = spec[0]
		if (d)
			name += " (PR)"
		let laneName = spec[d+1]
		if (laneName) {
			let lane = new Lane(name, laneName)
			lanes.push(lane)
			lane.load()
		}
	}
}

// PRESENTATION

let loadingIcon = <span><img className="icon" src="images/loading.gif" /> Loading...</span>

let LoadingBox = React.createClass({
	render: function() {
		let dirty = false
		for (let lane of lanes)
			if (!(lane.status.loaded || lane.buildsRemaining > 0))
				dirty = true

		if (dirty)
			return <div className="loadingBox"><p>{loadingIcon}</p></div>
		else
			return <div>&nbsp;</div>
	}
})

let ErrorBox = React.createClass({
	render: function() {
		let errors = lanes.filter(lane => lane.status.failed)
		if (errors.length) {
			let errorDisplay = lanes.map(lane =>
				<div className="errorItem">
					<img className="icon" src="images/error.png" title={lane.url} />
					Failed to load index for lane <strong>{lane.name}</strong>
				</div>
			)
			return <div className="errorBox">{errorDisplay}</div>
		} else {
			return null
		}
	}
})

let ContentArea = React.createClass({
	render: function() {
		let readyLanes = lanes.filter(lane => lane.status.loaded)
		if (readyLanes.length) {
			let laneDisplay = readyLanes.map(lane => {
				let readyBuilds = lane.builds.filter(build => build.loaded())
				let loader = (readyBuilds.length < lane.builds.length) ?
					<li className="loading">{loadingIcon}</li> :
					null
				let buildList = readyBuilds.map(build => {
					if (!build.failed())
						return <li key={build.id}>Build {build.id}: {build.date.toLocaleString()}, {build.result}</li>
					else
						return <li key={build.id}>Build {build.id}: <i>(Could not load)</i></li>
				})

				return <div className="verboseLane" key={lane.tag}>
					Lane <span className="laneName">{lane.name}</span>
					<ul>
						{buildList}
						{loader}
					</ul>
				</div>
			})
			return <div className="verboseContentList">
				{laneDisplay}
			</div>
		} else {
			return null
		}
	}
})

let needRender = false
function render() {
	ReactDOM.render(<div>
		<div className="pageTitle">Babysitter logs</div>
		<LoadingBox />
		<ErrorBox />
		<hr className="sectionDivider" />
		<ContentArea />
	</div>, document.getElementById('content'))
	needRender = false
}
function tryRender() {
	if (needRender)
		render()
}
function invalidateUi() {
	needRender = true
	setTimeout(tryRender, 0)
}
render()