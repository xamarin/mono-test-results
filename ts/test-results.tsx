/// <reference path="./test-download.ts" />
/// <reference path="./helper-react.tsx" />

// Constants

const max_failures_unexpanded = 5

declare var overloadShowLaneCheckboxes : number
const showLaneCheckboxes = typeof overloadShowLaneCheckboxes !== 'undefined' ? overloadShowLaneCheckboxes : false

// Load

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

	key() : string {
		return this.step + (this.test ? this.test : "")
	}

	equals(other:Failure) : boolean { // Allow match even if kind differs
		return this.step == other.step && this.test == other.test
	}
}

class MassFailure {
	constructor(public limit: number, public exampleFailure:Failure) {}
}

class MassFailureTracker {
	count:number
	massFailure: MassFailure

	constructor(massFailure: MassFailure) {
		this.count = 0
		this.massFailure = massFailure
	}

	feed(failure: Failure) {
		let targetFailure = this.massFailure.exampleFailure
		if (targetFailure.step == failure.step &&
			(!targetFailure.test || targetFailure.test == failure.test))
			this.count++
	}

	excess() {
		return this.count >= this.massFailure.limit
	}
}

// Here is a list of test suites which tend to fail all at once, and spuriously.
// For example if the X server dies, or the disk runs out of space, the result
// will be hundreds of failures of no informational value in the relevant suite.
let massFailures = [
	new MassFailure(1300,
		new Failure("make -w -C mcs/class/System.Windows.Forms run-test")
	)
]

// Load
class Build extends BuildStandard {
	failures: Failure[]
	massFailureTrackers: MassFailureTracker[]

	constructor(laneTag: string, id: string) {
		super(laneTag, id)
		this.failures = []
		this.massFailureTrackers = massFailures.map(f => new MassFailureTracker(f))
	}

	interpretMetadata(json) {
		if (hashHas('options')) console.log("Got metadata", json)

		super.interpretMetadata(json)
	}

	// See scripts/ci/babysitter in mono repo for json format
	interpretBabysitter(jsons: any[]) {
		if (hashHas('options')) console.log("Got babysitter", jsons)

		for (let json of jsons) {
			if (json.final_code) {
				let resolved = false
				if (json.babysitter_protocol || json.loaded_xml) {
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

						for (let tracker of this.massFailureTrackers)
							tracker.feed(failure)
					}
				}
				if (!resolved) {
					let failure = new Failure(json.invocation)
					if (json.final_code == "124")
						failure.kind = FailureKind.Hang
					this.failures.push(failure)
				}
			}
		}
	}

	massFailed() {
		return this.massFailureTrackers.some(tracker => tracker.excess())
	}
}

let lanes = makeLanes(Build)

// Display state

enum GroupBy {
	Lanes,
	Builds,
	Failures,
}

enum Visibility {
	Show,
	Hide
}

enum DisplaySpan {
	AllCached,
	Last7Days,
	Last48Hr,
	Last24Hr
}

class ChoiceVisibility extends Choice<Visibility> {}
let prVisible = new Ref(Visibility.Hide)
let massFailVisible = new Ref(Visibility.Show)
let inProgressVisible = new Ref(Visibility.Hide)

class CheckboxVisibility extends Checkbox<Visibility> {}
let laneVisible : Ref<Visibility>[] = null
if (showLaneCheckboxes)
	laneVisible = lanes.map(_ => new Ref(Visibility.Show))

class ChoiceGroupBy extends Choice<GroupBy> {}
let groupBy = new Ref(GroupBy.Lanes)

class ChoiceDisplaySpan extends Choice<DisplaySpan> {}
let displaySpan = new Ref(DisplaySpan.Last48Hr)

let testFilterStep = new Ref<string>(null)
let testFilterTest = new Ref<string>(null)

// Test filters

class TestFilter {
	constructor(public failure: Failure) {}

	match(build: Build) : boolean {
		for (let failure of build.failures) {
			if (this.failure.equals(failure))
				return true
		}
		return false
	}

	display() {
		if (this.failure.test)
			return <span className="failedTestName">{this.failure.test}</span>
		else
			return <span className="invocation">{this.failure.step}</span>
	}
}

// FIXME: This is a nasty hack.
function currentTestFilter() {
	return testFilterStep.value != null || testFilterTest.value != null
			? new TestFilter(new Failure(testFilterStep.value, testFilterTest.value))
			: null
}

// Utility

function filterLanes() {
	return lanes.filter( lane =>
		(prVisible.value == Visibility.Show || !lane.isPr)
	)
}

function buildInTimespan(build: Build) {
	let cutoff: number // In days
	switch (displaySpan.value) {
		case DisplaySpan.AllCached:
			return true
		case DisplaySpan.Last24Hr:
			cutoff = 1
			break
		case DisplaySpan.Last48Hr:
			cutoff = 2
			break
		case DisplaySpan.Last7Days:
			cutoff = 7
			break
	}
	let now = new Date()
	return +build.date > (+now - cutoff*dayMs)
}

function currentlyLoading() {
	for (let lane of filterLanes())
		if (!lane.status.loaded || lane.buildsRemaining > 0)
			return true
	return false
}

// Listing containers

class BuildListing extends Listing {
	failedLanes: number
	inProgressLanes: number
	lanes: { [laneIndex:number]: Build }

	constructor() {
		super()
		this.inProgressLanes = 0
		this.failedLanes = 0
		this.lanes = emptyObject()
	}
}

class FailureListing extends Listing {
	count: number
	builds: { [id:string]: boolean }
	lanes: { [laneIndex:number]: boolean }
	obj: Failure

	constructor(obj: Failure) {
		super()
		this.obj = obj
		this.count = 0
		this.builds = emptyObject()
		this.lanes = emptyObject()
	}
}

let isMakeLine = /make (?:-j\d+ )?-w V=1/

function buildFailure(failure: Failure) {
	return failure.step && (
		   startsWith(failure.step, "./autogen.sh")
		|| isMakeLine.test( failure.step )
	)
}

// Return true if all failures are build failures
function anyNonBuildFailures(build: Build) {
	for(let failure of build.failures) {
		if (!buildFailure(failure))
			return true
	}
	return false
}

// Presentation

let LoadingBox = React.createClass({
	render: function() {
		if (currentlyLoading())
			return <div className="loadingBox">{loadingIcon}</div>
		else
			return <div>&nbsp;</div>
	}
})

let ReloadControl = makeReloadControl(lanes, currentlyLoading)

class TestFilterDisplayProps {
	testFilter: TestFilter
}
class TestFilterDisplay extends React.Component<TestFilterDisplayProps, {}> {
	render() {
		if (!this.props.testFilter || groupBy.value == GroupBy.Failures)
			return null

		return <span> | Showing only {this.props.testFilter.display()} <Clickable label="[X]" key={null}
			handler={e => { // Note: Clears global handler
				testFilterStep.clear()
				testFilterTest.clear()
				invalidateUi()
		}} /></span>
	}
}

let LaneErrorBox = React.createClass({
	render: function() {
		let errors = filterLanes().filter(lane => lane.status.failed)
		if (errors.length) {
			let errorDisplay = errors.map(lane =>
				<div className="errorItem">
					<Icon src="images/error.png" />
					Failed to load index for lane <strong>{lane.name}</strong>
				</div>
			)
			return <div className="errorBox">{errorDisplay}</div>
		} else {
			return null
		}
	}
})

class FailureFilterLinkProps {
	count: number
	of: number
	isLane: boolean
	failure: Failure
}

class FailureFilterLink extends React.Component<FailureFilterLinkProps, {}> {
	render() {
		let label = "" + this.props.count + "/" + this.props.of + " " +
			(this.props.isLane ? "lanes" : "builds")

		return <Clickable label={label} key={null} handler={
			e => {
				testFilterStep.set( this.props.failure.step )
				testFilterTest.set( this.props.failure.test )
				groupBy.set( this.props.isLane ? GroupBy.Lanes : GroupBy.Builds )
				invalidateUi()
			}
		} />
	}
}

function renderFailure(failure: Failure) {
	let testLine = failure.test ? <div className="failedTestName">{failure.test}</div> : null
	let key = failure.step + "!" + failure.test
	return <li key={key} className="failure">
		<div>
			{failureDescribe(failure.kind)} while running <span className="invocation">{failure.step}</span>
		</div>
		{testLine}
	</li>
}

class BuildFailuresProps {
	lane: Lane<Build>
	build: Build
	key: string
	linkLabel: string
	extraLabel: JSX.Element
}

class BuildFailuresState {
	expand:boolean
}

class BuildFailures extends React.Component<BuildFailuresProps, BuildFailuresState> {
	constructor(props: BuildFailuresProps) {
		super(props)
		this.state = {expand: false}
	}
	render() {
		let build = this.props.build
		let key = this.props.key
		let buildLink = <span><A href={build.displayUrl} title={null}>{this.props.linkLabel}</A> {this.props.extraLabel}</span>

		if (!build.metadataStatus.failed) {
			let failures: JSX.Element[]
			let failureDisplay : JSX.Element = null

			if (!this.state.expand && build.failures.length > max_failures_unexpanded) {
				let showCount = max_failures_unexpanded - 1 // Never show "1 more failures"
				let failureSlice = build.failures.slice(0, showCount)
				let label = "[" + (build.failures.length - showCount)
					+ " more failures]"
				failures = failureSlice.map(renderFailure)
				failures.push(
					<li key="expand" className="failureExpand">
						<Icon src="images/error.png" /> {" "}
						<Clickable key="expand" label={label}
							handler={
								e => {
									this.setState({expand: true})
									invalidateUi()
								}
							} />
					</li>)
			} else {
				failures = build.failures.map(renderFailure)
			}

			if (failures.length)
				failureDisplay = <ul>{failures}</ul>
			else if (build.babysitterStatus.failed)
				failureDisplay = <i className="noLoad">(Test data did not load)</i>

			let linkJenkinsDisplay = anyNonBuildFailures(this.props.build) ?
					linkJenkins(this.props.lane, this.props.build) :
					null

			return <li key={key} className="buildResult">
				{buildLink} {formatDate(build.date)},{" "}
				<span className="buildResultString">{build.resultString()}</span> {" "}
				{linkJenkinsDisplay}
				{failureDisplay}
			</li>
		} else {
			return <li key={key} className="buildResultNoLoad">
				{buildLink}: <i className="noLoad">(Could not load)</i>
			</li>
		}
	}
}

function linkFor(build: Build, parens=true) {
	let title = build.prTitle ? build.prTitle : build.gitHash
	let display = build.pr ? `PR ${build.pr}` :  (parens?"":"Commit ") + build.gitDisplay()
	return <span className="sourceLink">{parens?"(":""}<A href={build.gitUrl()} title={title}>{display}</A>{parens?")":""}</span>
}

function linkJenkins(lane: Lane<Build>, build: Build) {
	let title = "Test results on Jenkins"
	let url = jenkinsBuildBaseUrl(lane.tag, build.id) + "/testReport"
	return <span>(<A href={url} title={title}>Failures</A>)</span>
}

let ContentArea = React.createClass({
	render: function() {
		let readyLanes = filterLanes().filter(
			lane => lane.visible() &&
				(!laneVisible || laneVisible[lane.idx].value == Visibility.Show)
		)
		let dateRange = new DateRange()
		let testFilter = currentTestFilter()

		if (readyLanes.length) {
			// FIXME: Don't do this all in one function...
			switch (groupBy.value) {

				// List of lanes, then builds under lanes, then failures under builds.
				case GroupBy.Lanes: {
					let laneDisplay = readyLanes.map(lane => {
						let builds = lane.builds()
						let loadedBuilds = builds.filter(build => build.loaded())
						let readyBuilds = loadedBuilds.filter(buildInTimespan)

						if (inProgressVisible.value == Visibility.Hide)
							readyBuilds = readyBuilds.filter(build => !build.inProgress())
						if (massFailVisible.value == Visibility.Hide)
							readyBuilds = readyBuilds.filter(build => !build.massFailed())
						if (testFilter) {
							readyBuilds = readyBuilds.filter(build => testFilter.match(build))

							// HACK: Hide this lane in the lane display
							if (!readyBuilds.length)
								return null
						}

						readyBuilds = readyBuilds.sort(
							(a:Build,b:Build) => (+b.date) - (+a.date))

						let loader = (loadedBuilds.length < builds.length) ?
							<li className="loading">{loadingIcon}</li> :
							null
						let buildList = readyBuilds.map(build => {
							dateRange.add(build.date) // Side effects in a map? Ew

							let linkLabel = "Build " + build.id
							return <BuildFailures lane={lane} build={build} key={build.id} linkLabel={linkLabel} extraLabel={linkFor(build)}/>
						})

						return <div className="verboseLane" key={lane.tag}>
							<A href={lane.displayUrl} title={null}>Lane {lane.name}</A>
							<ul>
								{buildList}
								{loader}
							</ul>
						</div>
					})

					return <div className="verboseLaneList">
						<p>Showing {formatRange(dateRange)}</p>
						{laneDisplay}
					</div>
				}

				// List of builds, then lanes under builds, then failures under lanes.
				case GroupBy.Builds: {
					let buildListings: {[key:string] : BuildListing} = emptyObject()
					for (let lane of readyLanes) {
						for (let build of lane.builds()) {
							if (!buildInTimespan(build))
								continue
							if (massFailVisible.value == Visibility.Hide && build.massFailed())
								continue
							if (testFilter && !testFilter.match(build))
								continue

							let buildListing = getOrDefault(buildListings, build.buildTag(),
									() => new BuildListing())

							if (build.failures.length)
								buildListing.failedLanes++
							if (build.inProgress())
								buildListing.inProgressLanes++

							dateRange.add(build.date)
							buildListing.dateRange.add(build.date)
							buildListing.lanes[lane.idx] = build
						}
					}

					if (inProgressVisible.value == Visibility.Hide) {
						let filteredBuildListings: {[key:string] : BuildListing} = {}
						for (let key of Object.keys(buildListings)) {
							let value = buildListings[key]
							if (value.inProgressLanes == 0) // TODO: Demand a certain # of lanes
								filteredBuildListings[key] = value
						}
						buildListings = filteredBuildListings
					}

					let buildDisplay = Object.keys(buildListings).sort(dateRangeLaterCmpFor(buildListings)).map(buildKey => {
						let extra: JSX.Element = null
						let buildListing = buildListings[buildKey]
						let laneDisplay = Object.keys(buildListing.lanes).sort(numericSort).map(laneIdx => {
							let build = buildListing.lanes[laneIdx]
							let lane = lanes[laneIdx]

							if (!extra)
								extra = linkFor(build, false)

							return <BuildFailures lane={lane} build={build} key={lane.idx} linkLabel={lane.name} extraLabel={null} />
						})

						if (!extra)
							extra = <span>Unknown</span>

						return <div className="verboseBuild" key={buildKey}>
							<b>{extra}</b>
							<ul>
								{laneDisplay}
							</ul>
						</div>
					})

					let failDisplay: JSX.Element = null

					if (!testFilter) {
						let failCount = objectValues(buildListings)
							.filter(buildListing => buildListing.failedLanes > 0)
							.length
						failDisplay = <span> | <b>{failCount} of {countKeys(buildListings)}</b> builds have failures:</span>
					}

					return <div className="verboseBuildList">
						<p>Showing {formatRange(dateRange)}{failDisplay}</p>
						<div className="buildList">
							{buildDisplay}
						</div>
					</div>
				}

				// List of failures, then builds under failures, then lanes under builds.
				case GroupBy.Failures: {
					let failureListings: {[key:string] : FailureListing} = emptyObject()
					let uniqueBuilds: { [id:string]: boolean } = emptyObject()
					let trials = 0

					for (let lane of readyLanes) {
						for (let build of lane.builds()) {
							if (build.inProgress() || !buildInTimespan(build))
								continue
							if (massFailVisible.value == Visibility.Hide && build.massFailed())
								continue

							trials++
							dateRange.add(build.date)
							uniqueBuilds[build.buildTag()] = true

							for (let failure of build.failures) {
								if (buildFailure(failure))
									continue

								let failureKey = failure.key()
								let failureListing = getOrDefault(failureListings, failureKey,
									() => new FailureListing(failure))
								failureListing.dateRange.add(build.date)
								failureListing.count++
								failureListing.lanes[lane.idx] = true
								failureListing.builds[build.buildTag()] = true
							}
						}
					}
					let failureDisplay = Object.keys(failureListings)
						.sort( (a:string,b:string) => failureListings[b].count - failureListings[a].count )
						.map( key => {
							let failureListing = failureListings[key]
							let failure = failureListing.obj
							let title = failure.test ?
								<div>
										<div className="failedTestName">{failure.test}</div>
										while running <span className="invocation">{failure.step}</span>
								</div> :
								<div className="invocation">{failure.step}</div>

							return <li className="failure" key={key}>
								{title}
								<b>{failureListing.count}</b> failure{failureListing.count>1?"s":""}{" "}
								(failed on <FailureFilterLink count={countKeys(failureListing.lanes)}
									of={readyLanes.length} isLane={true} failure={failure} />
									; <FailureFilterLink count={countKeys(failureListing.builds)}
									of={countKeys(uniqueBuilds)} isLane={false} failure={failure} />
								)
							</li>
						})

					return <div>
						<p>Showing {formatRange(dateRange)} | Out of <b>{trials}</b> runs:</p>
						<ul className="failureList">
							{failureDisplay}
						</ul>
					</div>
				}
			}
		} else {
			return null
		}
	}
})

registerRender( () => {
	let inProgressChoice = groupBy.value != GroupBy.Failures ?
		<span>{" "}|{" "}
			In progress <ChoiceVisibility enum={Visibility} data={inProgressVisible} value={inProgressVisible.value} />
		</span> :
		null

	let laneCheckboxDisplay = null
	if (laneVisible) {
		let laneCheckboxes : JSX.Element[] = []
		for (let idx in lanes) {
			let lane = lanes[idx]
			if (lane.isPr && prVisible.value == Visibility.Hide)
				continue
			let value = laneVisible[idx]
			laneCheckboxes.push(<span className="checkboxContainer">
				<CheckboxVisibility enum={Visibility} data={value} value={value.value}
					on={Visibility.Show} off={Visibility.Hide}
					label={lane.name} /> {" "}
			</span>)
		}
		laneCheckboxDisplay = <div><br /><div className="checkboxGrid">{laneCheckboxes}</div></div>
	}

	ReactDOM.render(<div>
		<TitleBar />
		<br />
		<ReloadControl />
		<div>
			Group by: <ChoiceGroupBy enum={GroupBy} data={groupBy} value={groupBy.value} />
			<br />
			Timespan: <ChoiceDisplaySpan enum={DisplaySpan} data={displaySpan} value={displaySpan.value} />
			<br />
			Filters:
			PRs <ChoiceVisibility enum={Visibility} data={prVisible} value={prVisible.value} /> {" "} | {" "}
			Mass-fails <ChoiceVisibility enum={Visibility} data={massFailVisible} value={massFailVisible.value} />
			{inProgressChoice}
			<TestFilterDisplay testFilter={currentTestFilter()} />
			{laneCheckboxDisplay}
		</div>
		<LoadingBox />
		<LaneErrorBox />
		<hr className="sectionDivider" />
		<ContentArea />
	</div>, document.getElementById('content'))
})
render()
