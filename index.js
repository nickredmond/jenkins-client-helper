var http = require('http');
require('q');

String.prototype.startsWith = function(str){
	return (this.indexOf(str) === 0);
};

exports.init = function(hostname, username, apiToken){
	exports.hostname = hostname;
	exports.username = username;
	exports.apiToken = apiToken;
};

exports.getLastCompletedBuild = function(jobName, client_response){
	var callback = function(response){
		var data = '';

		response.on('data', function(chunk){
			data += chunk;
		});
		response.on('end', function(){
			client_response.json(JSON.parse(data));
		});
	};

	http.get('http://' + exports.username + ':' + exports.apiToken + '@' + exports.hostname + '/job/' + jobName + '/lastCompletedBuild/api/json', callback);
};

function addTestResultsInfo(responses, nextLine, followingLine){
	var MINUTES_INDEX = 2;
	var SECONDS_INDEX = 4;
	var EXAMPLES_LABEL = "examples";
	var FAILURES_LABEL = "failures";
	var PENDING_LABEL = "pending";

	var nextLineParts = nextLine.split(' ');
	var testResultsParts = followingLine.split(' ');

	var minutesValue = nextLineParts[MINUTES_INDEX];
	var secondsValue = nextLineParts[SECONDS_INDEX];
	var examplesValue = 0;
	var failuresValue = 0;
	var pendingValue = 0;

	for (var j = 0; j < testResultsParts.length; j++){
		if (testResultsParts[j].replace(",", "") === EXAMPLES_LABEL){
			examplesValue = testResultsParts[j - 1];
		}
		else if (testResultsParts[j].replace(",", "") === FAILURES_LABEL){
			failuresValue = testResultsParts[j - 1];
		}
		else if (testResultsParts[j].replace(",", "") === PENDING_LABEL){
			pendingValue = testResultsParts[j - 1];
		}
	}

	var completionInfo = {
		minutesToComplete: minutesValue,
		secondsToComplete: secondsValue,
		numberExamples: examplesValue,
		numberFailures: failuresValue,
		numberPending: pendingValue
	};
	responses.testResultsInfo = completionInfo;
}

exports.getBuildLog = function(jobName, buildNumber, client_response){
	var callback = function(response){
		var data = '';
		var FAILURE_NAME_PATTERN = /[\d]+\)$/;
		var FAILED_EXAMPLE_LINE_INDEX = 1;
		var FAILED_EXAMPLE_NAME_INDEX = 1;
		var FAILURE_NUMBER_INDEX = 0;

		response.on('data', function(chunk){
			data += chunk;
		});

		response.on('end', function(){
			var lines = data.split("\n");

			var isLoggingFailures = false;
			var isLoggingFailedExamples = false;
			var isLoggingAbortedRake = false;
			var isLoggingExpectedFailures = false;

			var responses = {
				failures: [],
				failedExamples: [],
				abortedRakeStackTrace: [],
				expectedFailures: [],
				infoMessage: null,
				errorMessages: [],
				testResultsInfo: null
			};

			var nextFailure = null;

			for (var i = 0; i < lines.length; i++){
				var nextLine = lines[i].trim();

				if (nextLine.startsWith("Finished in")){
					isLoggingFailures = false;
					var followingLine = lines[i + 1].trim();
					addTestResultsInfo(responses, nextLine, followingLine);
				}
				if (isLoggingFailures){
					if (nextLine === ''){
						if (nextFailure !== null){
							responses.failures.push(nextFailure);
							nextFailure = null;
						}
					}
					else if (FAILURE_NAME_PATTERN.test(nextLine.split(' ')[0])){
						nextFailure = {
							testName: nextLine.split(')')[1].trim(),
							stackTrace: []
						}
					}
					else if (nextLine.startsWith("Finished in")){
						isLoggingFailures = false;
					}
					else nextFailure.stackTrace.push(nextLine);
				}
				else if (isLoggingFailedExamples){
					if (nextLine.startsWith('rspec')){
						var failedExampleData = nextLine.split('#');
						var failedExampleLine = failedExampleData[0].split(' ')[FAILED_EXAMPLE_LINE_INDEX];
						var failedExampleName = failedExampleData[FAILED_EXAMPLE_NAME_INDEX];

						responses.failedExamples.push({
							name: failedExampleName,
							codeLine: failedExampleLine
						});
					}
					else if (nextLine !== ''){
						isLoggingFailedExamples = false;
					}
				}
				else if (isLoggingAbortedRake){
					if (nextLine.startsWith("Finished:")){
						isLoggingAbortedRake = false;
					}
					else responses.abortedRakeStackTrace.push(nextLine);
				}
				else if (isLoggingExpectedFailures) {
					if (FAILURE_NAME_PATTERN.test(nextLine.split(' ')[0])){
						var failureParts = nextLine.split(')');
						var failureName = '';
						
						for (var j = 1; j < failureParts.length - 1; j++){
							failureName += failureParts[j] + ")";
						}
						failureName += failureParts[failureParts.length - 1];

						responses.expectedFailures.push({
							failureNumber: failureParts[FAILURE_NUMBER_INDEX].trim(),
							failureName: failureName
						});
					}
					else if (nextLine === "Finished: SUCCESS"){
						isLoggingExpectedFailures = false;
						responses.infoMessage = "Build Result: SUCCESS";
					}
				}
				else {
					if (nextLine === "Failures:"){
						isLoggingFailures = true;
					}
					else if (nextLine === "Failed examples:"){
						isLoggingFailedExamples = true;
					}
					else if (nextLine === "rake aborted!"){
						isLoggingAbortedRake = true;
					}
					else if (nextLine.startsWith("Pending: (Failures listed here are expected")){
						isLoggingExpectedFailures = true;
					}
				}
			}
			
			client_response.json({"buildLog": responses});
		});
	};

	http.get('http://' + exports.username + ':' + exports.apiToken + '@' + exports.hostname + '/job/' + jobName + '/' + buildNumber + '/consoleText', callback);
};