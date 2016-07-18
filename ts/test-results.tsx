/// <reference path="./test-download.ts" />
/// <reference path="./helper-react.tsx" />

// LOAD

enum FailureKind {
    Unknown,
    Test,
    Crash,
    Hang
}

function failureDescribe(kind: FailureKind) {
	switch (kind) {
		case FailureKind.Test:
			return "Testcase failure"
		case FailureKind.Crash:
			return "Crash"
		case FailureKind.Hang:
			return "Hang"
		default:
			return "Unknown failure"
	}
}

class Failure {
	step: string
	test: string
	kind: FailureKind

	constructor(step:string, test:string = null) {
		this.step = step
		this.test = test
		this.kind = FailureKind.Unknown
	}
}

class Build extends BuildBase {
	date: Date
	result: string
	failures: Failure[]

	constructor(laneTag: string, id: string) {
		super(laneTag, id)
		this.failures = []
	}

	// See scripts/ci/babysitter in mono repo for json format
	interpretBabysitter(jsons: any[]) {
		if ('debug' in options) console.log("Got babysitter", jsons)

		for (let json of jsons) {
			if (json.final_code) {
				let resolved = false
				if (json.babysitter_protocol) {
					for(let testName in json.tests) {
						let failure = new Failure(json.invocation, testName)
						let test = json.tests[testName]
						if (test.crash_failures)
							failure.kind = FailureKind.Crash
						else if (test.timeout_failures)
							failure.kind = FailureKind.Hang
						else if (test.normal_failures)
							failure.kind = FailureKind.Test

						this.failures.push(failure)
						resolved = true
					}
				}
				if (!resolved) {
					let failure = new Failure(json.invocation)
					this.failures.push(failure)
				}
			}
		}
	}

	interpretMetadata(json) {
		if ('debug' in options) console.log("Got metadata", json)

		this.date = new Date(+json.timestamp)
		this.result = json.result ? json.result : "(Unfinished)"
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
					<img className="icon" src="images/error.png" title={lane.apiUrl} />
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
					let buildLink = <A href={build.displayUrl}>Build {build.id}</A>
					if (!build.metadataStatus.failed) {
						let failures = build.failures.map(failure => {
							let testLine = failure.test ? <div className="failedTestName">{failure.test}</div> : null
							let key = failure.step + "!" + failure.test
							let debugInfo = 'debug' in options ? " ("+build.babysitterSource+")" : null
							return <li key={key} className="verboseBuildFailure">
								<div>
									{failureDescribe(failure.kind)} while running <span className="invocation">{failure.step}</span>
									{debugInfo}
								</div>
								{testLine}
							</li>
						})
						let failureDisplay : JSX.Element = null

						if (failures.length)
							failureDisplay = <ul>{failures}</ul>
						else if (build.babysitterStatus.failed)
							failureDisplay = <i className="noLoad">(Test data did not load)</i>

						return <li key={build.id} className="buildResult">
							{buildLink}:
							<span className="datetime">{build.date.toLocaleString()}</span>,
							<span className="buildResultString">{build.result}</span>
							{failureDisplay}
						</li>
					} else {
						return <li key={build.id} className="buildResultNoLoad">
							{buildLink}: <i className="noLoad">(Could not load)</i>
						</li>
					}
				})

				return <div className="verboseLane" key={lane.tag}>
					<A href={lane.displayUrl}>Lane {lane.name}</A>
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