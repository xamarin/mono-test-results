/// <reference path="./test-download.ts" />
/// <reference path="./helper-react.tsx" />

/*
 * This file is responsible for taking data from test-download.ts
 * and unpacking and formatting it appropriate for a quickie status view.
 */

// --- Download and unpack data ---

let statusLanes = makeLanes(BuildStandard)

let coreLaneTotal = 0
for (let lane of statusLanes) {
	if (lane.isCore)
		coreLaneTotal++
}

// --- Display data ---

// A Listing for a particular git commit which was built across multiple lanes
class StatusBuildListing extends Listing {
	lanes: { [laneIndex:number]: BuildStandard }
	ready: { [laneIndex:number]: boolean } // Lane ready to display in "top row" if true
	inProgress: { [laneIndex:number]: boolean } // Lane known in progress if true
	coreCount: number // How many "core" lanes (tested on every commit) are finished for this build?
	lowestLaneIdx: number // Lowest key in "lanes" table (used for sorting)

	constructor(public displayUrl: string, public gitDisplay: string) {
		super()
		this.lanes = {}
		this.ready = {}
		this.inProgress = {}
		this.coreCount = 0
		this.lowestLaneIdx = statusLanes.length + 1 // Default to impossibly high value
	}
}

class BuildStatusProps {
	buildListing: StatusBuildListing
	inProgressDisplay: Boolean
}

// Status display for a single build
class BuildStatus extends React.Component<BuildStatusProps, {}> {
	constructor(props: BuildStatusProps) {
		super(props)
	}
	render() {
		let buildListing = this.props.buildListing
		let buildLink = <span><A href={buildListing.displayUrl} title={null}>Commit {buildListing.gitDisplay}</A></span>
		let displayList: JSX.Element[] = []
		let stillLoading = false

		// For each lane associated with build
		for (let lane of Object.keys(buildListing.lanes)) {
			// For main display, only show entries that are present.
			if (!(this.props.inProgressDisplay || buildListing.ready[+lane]))
				continue

			let build = buildListing.lanes[+lane]

			// Don't try to display entries which we are still loading information about.
			// However if this build is in the in-progress row and lanes are still loading,
			// show an indicator after all lanes to communicate things are known missing.
			if (!build.metadataStatus.loaded) {
				if (this.props.inProgressDisplay)
					stillLoading = true
				continue
			}

			// Build JSX element
			let buildLink = <span><A href={build.displayUrl} title={null}>{statusLanes[lane].name}</A> (build {build.id})</span>
			let className:string = null

			// Set icon for lane entry (via CSS class)
			switch(build.result) {
				case "UNSTABLE":
					className = "warning"
					break
				case "SUCCESS":
					className = "ok"
					break
				case null:
					break
				default:
					className = "failure"
					break
			}

			displayList.push(
				<li key={lane} className={className}>
					{buildLink} {formatDate(build.date)},{" "}
					<span className="buildResultString">{build.resultString()}</span>
				</li>
			)
		}

		if (stillLoading)
			displayList.push(<li className="loading">{loadingIcon}</li>)

		return <div className="buildStatusList">
			{buildLink}
			<ul>{displayList}</ul>
		</div>
	}
}

function statusCurrentlyLoading() { // Slight redundancy with test-results
	for (let lane of statusLanes)
		if (!lane.status.loaded || lane.buildsRemaining > 0)
			return true
	return false
}

let StatusReloadControl = makeReloadControl(statusLanes, statusCurrentlyLoading)

// This display sorts and bunches together builds by following various
// sorta-vague heuristics fitting the goals:
// - We would prefer to display only one build, containing all lanes
// - But this is not possible with "non-core" builds, which run only nightly
// It winds up showing the last git commit with builds for ALL core lanes,
// followed by the most recent SINGLE build result for each non-core lane,
// followed by any builds which got skipped over while making that list.
let StatusArea = React.createClass({
	render: function() {
		let readyLanes = statusLanes.filter(lane => lane.visible())
		let dateRange = new DateRange()

		if (readyLanes.length) {
			// Categorize builds, and group by git hash
			let buildListings: {[key:string] : StatusBuildListing} = {}

			// For each lane whose data is loaded:
			for (let lane of readyLanes) {
				// For each known build for that lane:
				for (let build of lane.builds()) {
					// Find or create the associated listing object, and add the date, lane, and progress information
					let buildListing = getOrDefault(buildListings, build.buildTag(),
							() => new StatusBuildListing(build.gitUrl(), build.gitDisplay()))

					buildListing.dateRange.add(build.date)
					buildListing.lanes[lane.idx] = build
					if (build.inProgress()) {
						buildListing.inProgress[lane.idx] = true
					} else {
						buildListing.ready[lane.idx] = true
						if (lane.isCore)
							buildListing.coreCount++
					}
				}
			}

			// Scan same-git-hash groups of builds and decide which to display

			let core:StatusBuildListing
			// Builds with finished lanes
			let ready:StatusBuildListing[] = []
			// Builds with relevant in-progress lanes
			let inProgress:StatusBuildListing[] = []
			// Has this lane seen a ready build yet?
			let laneReady = statusLanes.map(_ => false)
			let laneReadyCount = 0
			// For each same-git-hash group
			for (let key of Object.keys(buildListings).sort(dateRangeLaterCmpFor(buildListings))) {
				let buildListing = buildListings[key]
				let groupReady = false
				let groupInProgress = false
				let missingCores = buildListing.coreCount < coreLaneTotal

				// For each lane contributing to this group
				for (let idx in buildListing.lanes) {
					let alreadyDisplayed = laneReady[idx]
					let readyCanDisplay = buildListing.ready[idx]
					let blockedByCoreRules = missingCores && statusLanes[idx].isCore

					// Already displayed a ready entry for this lane, hide this
					if (alreadyDisplayed) {
						buildListing.ready[idx] = false // KLUDGE
					} else {
						// Lane is ready to display
						if (readyCanDisplay) {
							// , but can't be because it's missing core lanes
							if (blockedByCoreRules) {
								buildListing.ready[idx] = false // KLUDGE
								groupInProgress = true
							// , and wil be displayed
							} else {
								groupReady = true
								laneReady[idx] = true
								laneReadyCount++
								if (buildListing.lowestLaneIdx > +idx)
									buildListing.lowestLaneIdx = +idx // KLUDGE
							}
						// Lane is in progress and this build should be added to the in progress list
						} else if (buildListing.inProgress[idx]) {
							groupInProgress = true
						}
					}
				}

				// Decide which row (if either) this git hash group should appear in
				if (groupReady)
					ready.push(buildListing)
				if (groupInProgress)
					inProgress.push(buildListing)

				// If all lanes are now accounted for, stop searching
				if (laneReadyCount >= laneReady.length)
					break
			}

			let readyDisplay = ready.sort( (a,b) => a.lowestLaneIdx - b.lowestLaneIdx ).map(buildListing =>
				<BuildStatus buildListing={buildListing} inProgressDisplay={false} />
			)

			let inProgressDisplay = inProgress.map(buildListing =>
				<BuildStatus buildListing={buildListing} inProgressDisplay={true} />
			)
			if (inProgressDisplay.length) {
				inProgressDisplay.unshift(
					<p className="pageCategory">In progress builds:</p>
				)
				inProgressDisplay.unshift(<hr />)
			}

			let loadingDisplay = !readyDisplay.length && !inProgressDisplay.length ? loadingIcon : null

			return <div>
				<p className="pageCategory">
					Most recent build:
					<StatusReloadControl />
				</p>
				{readyDisplay}
				{inProgressDisplay}
				{loadingDisplay}
			</div>

		} else {
			return loadingIcon
		}
	}
})

registerRender( () => {
	ReactDOM.render(
		<div>
			<TitleBar />
			<div className="container">
				<StatusArea />
			</div>
		</div>
		, document.getElementById('content'))
})
render()
