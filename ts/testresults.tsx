/// <reference path="./testdownload.ts" />

// LOAD

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

let lanes = makeLanes(Build)

// PRESENTATION

let loadingIcon = <span><img className="icon" src="images/loading.gif" /> Loading...</span>

let LoadingBox = React.createClass({
	render: function() {
		let dirty = false
		for (let lane of lanes)
			if (!lane.status.loaded || lane.buildsRemaining > 0)
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