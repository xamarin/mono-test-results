/// <reference path="../typings/tsd.d.ts" />

class AProps {
	href: string
}

class A extends React.Component<AProps,{}> {
	render() {
		return <a href={this.props.href} target='_blank' >
			{(this.props as any).children}
		</a>
	}
}
