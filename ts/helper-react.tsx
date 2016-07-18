/// <reference path="helper.ts" />

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

/* FIXME: I'm not sure why "value" had to be passed in explicitly; it ought to
 * be derivable from data, but when I tried that I didn't get rerenders. Maybe
 * I am not using React correctly here. */
class ChoiceProps<Key> {
	enum: any
	data: Ref<Key>
	value: Key
}

class Choice<Key> extends React.Component<ChoiceProps<Key>, {}> {
	selection: string

	constructor(props: ChoiceProps<Key>) {
		super(props)
	}

	render() {
		let children: JSX.Element[] = []
		let first = true
		for (let key of enumStringKeys(this.props.enum)) {
			let value = this.props.enum[key] as Key

			if (!first)
				children.push(<span key={"comma"+value}>, </span>)

			if (value == this.props.value) {
				children.push(<span key={"button"+value}>{key}</span>)
			} else {
				children.push(<a key={"button"+value}
					href="javascript:void(0)"
					className="clickable"
					onClick={
						e => {
							this.props.data.value = value
							invalidateUi()
						}
					}
				>{key}</a>)
			}
			first = false
		}
		return <span className="choice">{children}</span>
	}
}
