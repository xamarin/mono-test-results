Human readable display of Mono Jenkins logs.

To set up this project, run:

    npm install -g typescript tsd
    make tsd

Then to build, run:

    make

Because of a web browser security feature called CORS, the files from Jenkins this web app loads can only be loaded if the app is being served from jenkins.mono-project.com. This means if you want to test the app locally, you will need to disable CORS temporarily. I suggest using the [CORS toggle plugin](https://chrome.google.com/webstore/detail/cors-toggle/omcncfnpmcabckcddookmnajignpffnh?hl=en) for Chrome.