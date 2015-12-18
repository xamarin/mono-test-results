/// <reference path="../typings/tsd.d.ts" />

let LoadingBox = React.createClass({
  render: function() {
    return (
      <div className="loadingBox">
        Loading...
      </div>
    );
  }
});

ReactDOM.render(<LoadingBox />, document.getElementById('content'))