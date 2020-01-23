"use strict";

//Imports
const fs = require('fs')
const app = require("express")();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const axios = require("axios");
const jwt = require('jsonwebtoken');

const config = require('./config/default.json');
const openIDTokenURL = 'https://www.googleapis.com/oauth2/v4/token';
const serviceAccount = require('./security.json');

//Parameters
const url = config.svcUrl;
const subscriptionName = config.subscriptionName;
const port = process.env.PORT || 3000;
console.log(port);

//TO CONNECT TO FRONTEND CLIENTS
app.get("/", function (req, res) {
  res.sendFile(__dirname + "/test.html");
});

//Get security token every 40 minutes
getSecurityToken();
setInterval(getSecurityToken, 60000 * 40);

//TO SETUP WEBSOCKET USING SOCKET.IO
io.on("connection", function (socket) {
  console.log("Client is connected");

  socket.on("disconnect", function () {
    console.log("Client has disconnected");
  });

  socket.on("message", function (message) {
    //TO HANDLE MESSAGE RECEIVED FROM CLIENT
    console.log("Received Message:", message);
  });

  socket.on("CUSTOM_EVENT", function (message) {
    //TO HANDLE ANY CUSTOM EVENT RECEIVED FROM CLIENT
    console.log("Received Custom Event:", message);

    var customResponse = {
      id: message.id,
      place: message.place,
      name: message.name
    };

    updateCustomEvent(customResponse);

    //Broadcast custom event to all other clients
    socket.broadcast.emit("CUSTOM_EVENT", JSON.stringify(customResponse));
  });
});

// //TO INITIATE WEBSOCKET SERVER
http.listen(port, function () {
  console.log(`WebSocket is listening on port: ${port}`);
});

//A FUNCTION TO LISTEN FOR MESSAGES FROM PUBSUB
//Pass 0 as second argument to constantly listen for messages
listenForMessages(subscriptionName, 0);

function listenForMessages(subscriptionName, timeout) {
  // [START pubsub_subscriber_async_pull]
  // Imports the Google Cloud client library
  const { PubSub } = require("@google-cloud/pubsub");

  // Creates a client
  const pubsub = new PubSub();
  console.log(`Connected to PubSub.`);

  // References an existing subscription
  const subscription = pubsub.subscription(subscriptionName);

  console.log(`Listening to incoming messages...`);
  // Create an event handler to handle messages
  let messageCount = 0;
  const messageHandler = message => {
    console.log(`Received message ${message.id}:`);
    console.log(`\tData: ${message.data}`);

    console.log(`\tAttributes: ${message.attributes}`);
    console.log(message.attributes);
    messageCount += 1;

    var formattedMessage = JSON.parse(message.data);

    //Insert the event to Firestore
    insertEvent(formattedMessage);

    // "Ack" (acknowledge receipt of) the message
    message.ack();
  };

  // Listen for new messages until timeout is hit
  subscription.on(`message`, messageHandler);

  if (timeout !== 0) {
    setTimeout(() => {
      subscription.removeListener("message", messageHandler);
      console.log(`${messageCount} message(s) received.`);
    }, timeout * 1000);
  }
  // [END pubsub_subscriber_async_pull]
}

//TO INSERT NEW EVENTS FROM PUBSUB
function insertEvent(userInput) {
  let body = userInput;

  //CALL EXTERNAL API TO HANDLE EVENT
  axios
    .post(url + "customEvent", userInput)
    .then(function (response) {
      //NOTIFY ALL CLIENTS ABOUT CUSTOM EVENT
      io.emit("CUSTOM_PUBSUB_EVENT", response);
    })
    .catch(function (error) {
      console.error("Error adding document: ", error);
    });
}

//SAMPLE FUNCTION TO GET SECURITY JWT TOKEN FROM GOOGLE
function getSecurityToken() {
  let privateKey = serviceAccount['private_key'];
  var data = {
    "iss": serviceAccount['client_email'],
    "sub": serviceAccount['client_email'],
    "aud": "https://www.googleapis.com/oauth2/v4/token",
    "iat": Math.round((new Date()).getTime() / 1000),
    "exp": Math.round((new Date()).getTime() / 1000) + 3600,
    "target_audience": "GET THIS FROM SECURITY JSON FILE"
  };

  let token = jwt.sign(data, privateKey, { algorithm: 'RS256' });
  axios
    .post(`${openIDTokenURL}`, {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: token,
    })
    .then(function (response) {
      const data = response.data;
      var openIDToken = data.id_token;
      console.log(openIDToken);
      axios.defaults.headers.common = { 'Authorization': `Bearer ${openIDToken}` }
      return (openIDToken);
    })
    .catch(function (error) {
      console.error("Error getting access token: ", error);
      return ('There is an error occured while getting Token. Please, try again later');
    });
}

