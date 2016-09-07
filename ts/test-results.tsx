/// <reference path="./test-download.ts" />
/// <reference path="./helper-react.tsx" />

ReactDOM.render(<div>TODO</div>, document.getElementById('content'))

// Constants

const max_failures_unexpanded = 5
const dayMs = 24*60*60*1000

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

	equals(other:Failure) : boolean {
		return this.step == other.step && this.test == other.test && this.kind == other.kind
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

let yes = {}
let no = {}

// Load
class Build extends BuildBase {
	date: Date
	result: string
	building: boolean
	failures: Failure[]
	gitHash: string
	pr: string
	prUrl: string
	prTitle: string
	massFailureTrackers: MassFailureTracker[]
	laneTagTemp: string // REMOVE ME

	constructor(laneTag: string, id: string) {
		super(laneTag, id)
		this.failures = []
		this.massFailureTrackers = massFailures.map(f => new MassFailureTracker(f))
		this.laneTagTemp = laneTag
	}

	interpretMetadata(json) {
		if ('debug' in options) console.log("Got metadata", json)

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
							case "ghprbActualCommit":
								prHash = param.value
								break
							default: break
						}
					}
				} else if (action._class == "hudson.plugins.git.util.BuildData") {
					// There will be one of these for the standards suite repo and one of these for the "real" git repo
					if (action.lastBuiltRevision && action.remoteUrls && action.remoteUrls[0] == gitRepo) {
						this.gitHash = action.lastBuiltRevision.SHA1
					}
				}
			}
		}

		// In a PR branch, the ghprbActualCommit represents the commit that triggered the build,
		// and the last built revision is some temporary thing that half the time isn't even reported.
		this.gitHash = prHash ? prHash : gitHash
	}

	// See scripts/ci/babysitter in mono repo for json format
	interpretBabysitter(jsons: any[]) {
		if ('debug' in options) console.log("Got babysitter", jsons)

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
		return this.gitHash
	}

	url() {
		if (this.prUrl)
			return this.prUrl
		return "https://github.com/mono/mono/commit/" + this.gitHash
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

class ChoiceGroupBy extends Choice<GroupBy> {}
let groupBy = new Ref(GroupBy.Lanes)

class ChoiceDisplaySpan extends Choice<DisplaySpan> {}
let displaySpan = new Ref(DisplaySpan.Last48Hr)

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

let testFilter = null

// Utility

function filterLanes() {
	return lanes.filter( lane =>
		(prVisible.value == Visibility.Show || !lane.isPr)
	)
}

function formatDate(date: Date) {
	let day = null
	let now = new Date()
	if (sameDay(now, date)) {
		day = "Today"
	} else {
		let yesterday = new Date(+now - dayMs)
		if (sameDay(yesterday, date))
			day = "Yesterday"
	}

	if (day)
		return <span className="datetime">{day} {date.toLocaleTimeString()}</span>
	else
		return <span className="datetime">{date.toLocaleString()}</span>
}

class DateRange {
	early:Date
	late:Date

	add(date: Date) {
		if (!date)
			return
		if (!this.early || date < this.early)
			this.early = date
		if (!this.late || date > this.late)
			this.late = date
	}
}

function formatRange(range: DateRange) {
	if (!range.early || !range.late)
		return <i>(Invalid date)</i>
	return <span className="datetimeRange">{formatDate(range.early)} - {formatDate(range.late)}</span>
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

class Listing {
	dateRange: DateRange

	constructor() {
		this.dateRange = new DateRange()
	}
}

class BuildListing extends Listing {
	failedLanes: number
	inProgressLanes: number
	lanes: { [laneIndex:number]: Build }

	constructor() {
		super()
		this.inProgressLanes = 0
		this.failedLanes = 0
		this.lanes = {}
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
		this.builds = {}
		this.lanes = {}
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

let loadingIcon = <span><Icon src="images/loading.gif" /> Loading...</span>

let LoadingBox = React.createClass({
	render: function() {
		if (currentlyLoading())
			return <div className="loadingBox">{loadingIcon}</div>
		else
			return <div>&nbsp;</div>
	}
})

let everLoaded = false

let ReloadControl = React.createClass({
	render: function() {
		let loading = currentlyLoading()

		if (!everLoaded) { // Don't display before first load completes
			if (loading)
				return null
			everLoaded = true
		}

		let reloadControl = <span><Icon src="images/reload.png" /> Reload</span>

		if (!currentlyLoading())
			reloadControl = <ClickableSpan key={null} handler={
				e => {
					for (let lane of lanes) {
						lane.status = new Status()
						lane.load()
					}
					invalidateUi()
				}
			}>{reloadControl}</ClickableSpan>

		return <div className="reloadControl">{reloadControl}</div>
	}
})

let TestFilterDisplay = React.createClass({
	render: function() {
		if (!testFilter || groupBy.value == GroupBy.Failures)
			return null

		return <span> | Showing only {testFilter.display()} <Clickable label="[X]" key={null}
			handler={e => {
				testFilter = null
				invalidateUi()
		}} /></span>
	}
})

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
				testFilter = new TestFilter(this.props.failure)
				groupBy.value = this.props.isLane ? GroupBy.Lanes : GroupBy.Builds
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

function linkPr(build: Build, title:boolean = false) {
	if (build.pr) {
		let titleDisplay = title ?
			[
				<span> </span>,
				<span className="prTitle">"{build.prTitle}"</span>
			] :
			null
		return <span className="prLink">(<A href={build.prUrl} title={build.prTitle}>PR {build.pr}</A>{titleDisplay})</span>
	} else {
		return null
	}
}

function linkJenkins(lane: Lane<Build>, build: Build) {
	let title = "Test results on Jenkins"
	let url = jenkinsBuildBaseUrl(lane.tag, build.id) + "/testReport"
	return <span>(<A href={url} title={title}>Failures</A>)</span>
}

let ContentArea = React.createClass({
	render: function() {
		let readyLanes = filterLanes().filter(lane => lane.visible())
		let dateRange = new DateRange()

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
							return <BuildFailures lane={lane} build={build} key={build.id} linkLabel={linkLabel} extraLabel={linkPr(build)}/>
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
					let buildListings: {[key:string] : BuildListing} = {}
					for (let lane of readyLanes) {
						for (let build of lane.builds()) {
							if (!buildInTimespan(build))
								continue
							if (massFailVisible.value == Visibility.Hide && build.massFailed())
								continue
							if (testFilter && !testFilter.match(build))
								continue

							let buildListing = getOrDefault(buildListings, build.id,
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

					let buildDisplay = Object.keys(buildListings).sort(
							(a:string,b:string) => { // Sort by date
								let ad = buildListings[a].dateRange.late
								let bd = buildListings[b].dateRange.late
								return ((+bd) - (+ad))
							}
						).map(buildKey => {
						let extra: JSX.Element = null
						let buildListing = buildListings[buildKey]
						let laneDisplay = Object.keys(buildListing.lanes).sort(numericSort).map(laneIdx => {
							let build = buildListing.lanes[laneIdx]
							let lane = lanes[laneIdx]

							if (build.pr && !extra)
								extra = linkPr(build)

							return <BuildFailures lane={lane} build={build} key={lane.idx} linkLabel={lane.name} extraLabel={null} />
						})

						return <div className="verboseBuild" key={buildKey}>
							<b>Build {buildKey}</b> {extra}
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
					let failureListings: {[key:string] : FailureListing} = {}
					let uniqueBuilds: { [id:string]: boolean } = {}
					let trials = 0

					for (let lane of readyLanes) {
						for (let build of lane.builds()) {
							if (build.inProgress() || !buildInTimespan(build))
								continue
							if (massFailVisible.value == Visibility.Hide && build.massFailed())
								continue

							trials++
							dateRange.add(build.date)
							uniqueBuilds[build.id] = true

							for (let failure of build.failures) {
								if (buildFailure(failure))
									continue

								let failureKey = failure.key()
								let failureListing = getOrDefault(failureListings, failureKey,
									() => new FailureListing(failure))
								failureListing.dateRange.add(build.date)
								failureListing.count++
								failureListing.lanes[lane.idx] = true
								failureListing.builds[build.id] = true
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

	ReactDOM.render(<div>
		<div className="pageTitle">Babysitter logs</div>
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
			<TestFilterDisplay />
		</div>
		<LoadingBox />
		<LaneErrorBox />
		<hr className="sectionDivider" />
		<ContentArea />
	</div>, document.getElementById('content'))
})
render()
