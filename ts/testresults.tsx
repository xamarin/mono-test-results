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

function jenkinsBuildUrl(lane:string, id:string) {
	return jenkinsBaseUrl(lane) + "/" + id
}

function jenkinsBabysitterUrl(lane:string, id:string) {
	return jenkinsBuildUrl(lane, id) + "/artifact/babysitter_report.json_lines"
}

let jenkinsLaneSpecs = [ // Name, Regular Jenkins job, PR Jenkins job
	["Linux 64-bit",   "test-mono-mainline/label=debian-amd64", "test-mono-pull-request-amd64"],
	["Linux 32-bit",   "test-mono-mainline/label=debian-i386",  "test-mono-pull-request-i386"],
	["Mac 32-bit",     "test-mono-mainline/label=osx-i386",     null],
	["Android",        "test-mono-mainline/label=debian-armel", "test-mono-pull-request-armel"],
	["Linux ARM",      "test-mono-mainline/label=debian-armhf", "test-mono-pull-request-armhf"],
	["Windows 32-bit", "z/label=w32",                           "w"]
]

class Build {
	id: string
	loaded: boolean

	constructor(id: string) {
		this.id = id
		this.loaded = false
	}
}

// Object tracks/downloads one lane's worth of tests
// TODO:
// - Fetch jobs list from Lane url
// - Fetch URL like https://jenkins.mono-project.com/job/test-mono-mainline/label=debian-amd64/3063/artifact/babysitter_report.json_lines
//   from job number
class Lane {
	name: string  // Human-readable
	tag: string   // URL component
	url: string
	loaded: boolean
	failed: boolean
	builds: Build[]

	constructor(name:string, laneName:string) {
		this.name = name
		this.tag = laneName
		this.url = jenkinsLaneUrl(laneName)
		this.loaded = false
		this.failed = false
		this.builds = []
	}

	load() {
		if ('debug' in options) console.log("lane loading url", this.url)
		$.get(this.url, laneResult => {
			this.loaded = true
			if ('debug' in options) console.log("lane loaded url", this.url, "result:", laneResult)
			let queries = 0

			for (let buildInfo of laneResult.builds) {
				let build = new Build(buildInfo.number)
				this.builds.push(build)

				let babysitterUrl = jenkinsBabysitterUrl(this.tag, build.id)
				if ('debug' in options) console.log("build", build.id, "for lane", this.name, "loading url", babysitterUrl)

				$.get(babysitterUrl, buildResult => {
					if ('debug' in options) console.log("build loaded url", babysitterUrl, "result:", buildResult)

				}).fail(() => {
					console.log("Failed to load url for lane", babysitterUrl);
				})

				queries++
				if (queries >= max_build_queries)
					break
			}

			invalidateUi()
		}).fail(() => {
            console.log("Failed to load url for lane", this.url);
			this.failed = true
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

let LoadingBox = React.createClass({
	render: function() {
		let dirty = false
		lanes.forEach( function (lane) {
			if (!(lane.loaded || lane.failed))
				dirty = true
		} )
		if (dirty)
			return (
				<div className="loadingBox">
				<p><img className="icon" src="images/loading.gif" /> Loading...</p>
				</div>
			)
		else
			return (
				<div>&nbsp;</div>
			)
	}
})

let ErrorBox = React.createClass({
	render: function() {
		let errors = lanes.filter(function(lane) { return lane.failed })
		if (errors.length) {
			let errorList = lanes.map(function (lane) {
				return (
					<div className="errorItem">
					<img className="icon" src="images/error.png" title={lane.url} />
					Failed to load index for lane <strong>{lane.name}</strong>
					</div>
				)
			})
			return <div className="errorBox">{errorList}</div>
		}
		else {
			return null
		}
	}
})

let needRender = false
function render() {
	ReactDOM.render(<div>
		<div className="title">Babysitter logs</div>
		<LoadingBox />
		<ErrorBox />
	</div>, document.getElementById('content'))
	needRender = false
}
function tryRender() {
	if (needRender)
		render()
}
function invalidateUi() {
	needRender = true
	setTimeout(render, 0)
}
render()