/// <reference path="../typings/tsd.d.ts" />
/// <reference path="./helper.ts" />

// JOBS LIST //
function jenkinsUrl(lane) {
	return "https://jenkins.mono-project.com/job/"+lane+"/api/json"
}

let jenkinsLaneSpecs = [ // Name, Regular Jenkins job, PR Jenkins job
	["Linux 64-bit",   "test-mono-mainline/label=debian-amd64", "test-mono-pull-request-amd64"],
	["Linux 32-bit",   "test-mono-mainline/label=debian-i386",  "test-mono-pull-request-i386"],
	["Mac 32-bit",     "test-mono-mainline/label=osx-i386",     "bockbuild-with-mono-PR"],
	["Android",        "test-mono-mainline/label=debian-armel", "test-mono-pull-request-armel"],
	["Linux ARM",      "test-mono-mainline/label=debian-armhf", "test-mono-pull-request-armhf"],
	["Windows 32-bit", "z/label=w32",                           "w"]
]

// TODO:
// - Fetch jobs list from Lane url
// - Fetch URL like https://jenkins.mono-project.com/job/test-mono-mainline/label=debian-amd64/3063/artifact/babysitter_report.json_lines
//   from job number
class Lane {
	name: string
	url: string
	loaded: boolean

	constructor(name: string, laneName:string) {
		this.name = name
		this.url = jenkinsUrl(laneName)
		this.loaded = false
	}

	load() {
		$.get(this.url, function (result) {

		})
	}
}

let lanes: Lane[] = []

for (let c = 0; c < jenkinsLaneSpecs.length; c++) {
	for (let d = 0; d < 2; d++) {
		let name = jenkinsLaneSpecs[c][0]
		if (d)
			name += " (PR)"
		let laneName = jenkinsLaneSpecs[c][d+1]
		let lane = new Lane(name, laneName)
		lanes.push(lane)
	}
}

// PRESENTATION //

let LoadingBox = React.createClass({
  render: function() {
    return (
      <div className="loadingBox">
        <p>Loading...</p>
        <p>(Except not really)</p>
      </div>
    )
  }
})

ReactDOM.render(<LoadingBox />, document.getElementById('content'))
