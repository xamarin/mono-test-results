/// <reference path="../typings/tsd.d.ts" />

// JOBS LIST //
function jenkins_url(lane) {
	return "https://jenkins.mono-project.com/job/"+lane+"/api/json"
}

let jenkins_lane_specs = [ // Name, Regular Jenkins job, PR Jenkins job
	["Linux 64-bit",   "test-mono-mainline/label=debian-amd64", "test-mono-pull-request-amd64"],
	["Linux 32-bit",   "test-mono-mainline/label=debian-i386",  "test-mono-pull-request-i386"],
	["Mac 32-bit",     "test-mono-mainline/label=osx-i386",     "bockbuild-with-mono-PR"],
	["Android",        "test-mono-mainline/label=debian-armel", "test-mono-pull-request-armel"],
	["Linux ARM",      "test-mono-mainline/label=debian-armhf", "test-mono-pull-request-armhf"],
	["Windows 32-bit", "z/label=w32",                           "w"]
]

class Lane {
	name: string
	url: string
	loaded: boolean

	constructor(name: string, laneName:string) {
		this.name = name
		this.url = jenkins_url(laneName)
		this.loaded = false
	}
}

let lanes: Lane[] = []

for (let c = 0; c < jenkins_lane_specs.length; c++) {
	for (let d = 0; d < 2; d++) {
		let name = jenkins_lane_specs[c][0]
		if (d)
			name += " (PR)"
		let laneName = jenkins_lane_specs[c][d+1]
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
