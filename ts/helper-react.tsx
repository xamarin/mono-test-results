/// <reference path="helper.ts" />

class IconProps {
	src: string
}

class Icon extends React.Component<IconProps, {}> {
	render () {
		return <img className="icon" src={this.props.src} />
	}
}

class AProps {
	href: string
	title: string
}

class A extends React.Component<AProps,{}> {
	render() {
		return <a href={this.props.href} title={this.props.title} target='_blank' >
			{(this.props as any).children}
		</a>
	}
}

class ClickableProps {
	handler: React.EventHandler<React.MouseEvent>
	key: string
	label: string
}

class Clickable extends React.Component<ClickableProps, {}> {
	render() {
		return <a key={this.props.key}
					href="javascript:void(0)"
					className="clickable"
					onClick={this.props.handler}
				>{this.props.label}</a>
	}
}

/* FIXME: I'm not sure why "value" had to be passed in explicitly; it ought to
 * be derivable from data, but when I tried that I didn't get rerenders. Maybe
 * I am not using React correctly here. --Andi */
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

			let reactKey = "button"+value

			// Insert spaces into enum key name. I admit that this is a little silly.
			let label = key[0]
			for (let i = 1; i < key.length; i++) {
				let ch = key[i]
				if (isUpperCaseChar(ch) || (isNumberChar(ch) && !isNumberChar(key[i-1]))) {
					label += " "
					label += ch.toLowerCase()
				} else {
					label += ch
				}
			}

			if (value == this.props.value) {
				children.push(<span key={reactKey}>{label}</span>)
			} else {
				children.push(<Clickable key={reactKey} label={label}
					handler={
						e => {
							this.props.data.value = value
							invalidateUi()
						}
					} />)
			}
			first = false
		}
		return <span className="choice">{children}</span>
	}
}
