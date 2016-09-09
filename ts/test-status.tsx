/// <reference path="./test-download.ts" />
/// <reference path="./helper-react.tsx" />

let statusLanes = makeLanes(BuildStandard)

class StatusBuildListing extends Listing {
	inProgressLanes: number
	lanes: { [laneIndex:number]: BuildStandard }

	constructor(public displayUrl: string, public gitDisplay: string) {
		super()
		this.inProgressLanes = 0
		this.lanes = {}
	}
}

class BuildStatusProps {
	buildListing: StatusBuildListing
}

class BuildStatus extends React.Component<BuildStatusProps, {}> {
	constructor(props: BuildStatusProps) {
		super(props)
	}
	render() {
		let buildListing = this.props.buildListing
		let buildLink = <span><A href={buildListing.displayUrl} title={null}>Commit {buildListing.gitDisplay}</A></span>
		let displayList: JSX.Element[] = []
		let stillLoading = false

		for (let lane of Object.keys(buildListing.lanes)) {
			let build = buildListing.lanes[+lane]

			if (!build.metadataStatus.loaded) {
				stillLoading = true
				continue
			}

			let buildLink = <span><A href={build.displayUrl} title={null}>{statusLanes[lane].name}</A> (build {build.id})</span>
			let className:string = null

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

let StatusArea = React.createClass({
	render: function() {
		let readyLanes = statusLanes.filter(lane => lane.visible())
		let dateRange = new DateRange()

		if (readyLanes.length) {
			// Categorize builds
			let buildListings: {[key:string] : StatusBuildListing} = {}
			for (let lane of readyLanes) {
				for (let build of lane.builds()) {
					let buildListing = getOrDefault(buildListings, build.buildTag(),
							() => new StatusBuildListing(build.gitUrl(), build.gitDisplay()))

					if (build.inProgress())
						buildListing.inProgressLanes++

					buildListing.dateRange.add(build.date)
					buildListing.lanes[lane.idx] = build
				}
			}

			// Find newest finished build + anything newer
			let inProgress:StatusBuildListing[] = []
			let final:StatusBuildListing = null
			for (let key of Object.keys(buildListings).sort(dateRangeLaterCmpFor(buildListings))) {
				let buildListing = buildListings[key]
				if (buildListing.inProgressLanes) {
					inProgress.push(buildListing)
				} else {
					final = buildListing
					break
				}
			}

			let finalDisplay = final ? <div>
				<p className="pageCategory">Most recent build:</p>
				<BuildStatus buildListing={final} />
			</div> : null

			let inProgressDisplay = inProgress.map(buildListing =>
				<BuildStatus buildListing={buildListing} />
			)
			if (inProgressDisplay.length) {
				inProgressDisplay.unshift(
					<p className="pageCategory">In progress builds:</p>
				)
			}

			let loadingDisplay = !finalDisplay && !inProgressDisplay ? loadingIcon : null

			return <div>
				{finalDisplay}
				{inProgressDisplay}
				{loadingDisplay}
			</div>

		} else {
			return loadingIcon
		}
	}
})


registerRender( () => {
	ReactDOM.render(<div>
		<div>
			<span className="pageTitle">Quick status</span> | See also: <A href="failures.html" title={null}>Build failures</A>
		</div>
		<StatusArea />
	</div>, document.getElementById('content'))
})
render()
