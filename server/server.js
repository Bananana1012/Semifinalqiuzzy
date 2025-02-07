// Import dependencies
const path = require('path');
const http = require('http');
const express = require('express');
const socketIO = require('socket.io');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
const serviceAccount = require('../quizzy-de393-firebase-adminsdk-fbsvc-4d4891c1e7.json');  // Add your service account key file
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Import classes
const { LiveGames } = require('./utils/liveGames');
const { Players } = require('./utils/players');

const publicPath = path.join(__dirname, '../public');
var app = express();
var server = http.createServer(app);
var io = socketIO(server);
var games = new LiveGames();
var players = new Players();

app.use(express.static(publicPath));

// Starting server on port 3000
server.listen(3000, () => {
    console.log("Server started on port 3000");
});

// When a connection to the server is made from the client
io.on('connection', (socket) => {

    // When host connects for the first time
    socket.on('host-join', (data) => {

        // Check if id passed in URL corresponds to an id of a Kahoot game in Firestore
        const gameRef = db.collection('kahootGames').doc(data.id.toString());
        gameRef.get()
            .then(doc => {
                if (doc.exists) {
                    const gamePin = Math.floor(Math.random() * 90000) + 10000; // New pin for the game
                    games.addGame(gamePin, socket.id, false, { playersAnswered: 0, questionLive: false, gameid: data.id, question: 1 }); // Creates a game with pin and host id

                    var game = games.getGame(socket.id); // Gets the game data

                    socket.join(game.pin); // The host is joining a room based on the pin

                    console.log('Game Created with pin:', game.pin);

                    // Sending game pin to host so they can display it for players to join
                    socket.emit('showGamePin', {
                        pin: game.pin
                    });
                } else {
                    socket.emit('noGameFound');
                }
            })
            .catch(error => {
                console.error("Error fetching game:", error);
                socket.emit('noGameFound');
            });

    });

    // When the host connects from the game view
    socket.on('host-join-game', (data) => {
        var oldHostId = data.id;
        var game = games.getGame(oldHostId); // Gets game with old host id
        if (game) {
            game.hostId = socket.id; // Changes the game host id to new host id
            socket.join(game.pin);
            var playerData = players.getPlayers(oldHostId); // Gets players in the game
            for (var i = 0; i < Object.keys(players.players).length; i++) {
                if (players.players[i].hostId == oldHostId) {
                    players.players[i].hostId = socket.id;
                }
            }
            var gameid = game.gameData['gameid'];
            const gameRef = db.collection('kahootGames').doc(gameid.toString());
            gameRef.get()
                .then(doc => {
                    if (doc.exists) {
                        const question = doc.data().questions[0].question;
                        const answer1 = doc.data().questions[0].answers[0];
                        const answer2 = doc.data().questions[0].answers[1];
                        const answer3 = doc.data().questions[0].answers[2];
                        const answer4 = doc.data().questions[0].answers[3];
                        const correctAnswer = doc.data().questions[0].correct;

                        socket.emit('gameQuestions', {
                            q1: question,
                            a1: answer1,
                            a2: answer2,
                            a3: answer3,
                            a4: answer4,
                            correct: correctAnswer,
                            playersInGame: playerData.length
                        });
                    }
                })
                .catch(error => {
                    console.error("Error fetching game questions:", error);
                });

            io.to(game.pin).emit('gameStartedPlayer');
            game.gameData.questionLive = true;
        } else {
            socket.emit('noGameFound'); // No game was found, redirect user
        }
    });

    // When player connects for the first time
    socket.on('player-join', (params) => {

        var gameFound = false; // If a game is found with pin provided by player

        // For each game in the Games class
        for (var i = 0; i < games.games.length; i++) {
            // If the pin is equal to one of the game's pin
            if (params.pin == games.games[i].pin) {

                console.log('Player connected to game');

                var hostId = games.games[i].hostId; // Get the id of host of game

                players.addPlayer(hostId, socket.id, params.name, { score: 0, answer: 0 }); // add player to game

                socket.join(params.pin); // Player is joining room based on pin

                var playersInGame = players.getPlayers(hostId); // Getting all players in game

                io.to(params.pin).emit('updatePlayerLobby', playersInGame); // Sending host player data to display
                gameFound = true; // Game has been found
            }
        }

        // If the game has not been found
        if (gameFound == false) {
            socket.emit('noGameFound'); // Player is sent back to 'join' page because game was not found with pin
        }

    });

    // When the host starts the game
    socket.on('startGame', () => {
        var game = games.getGame(socket.id); // Get the game based on socket.id
        game.gameLive = true;
        socket.emit('gameStarted', game.hostId); // Tell player and host that game has started
    });

    // Give user game names data
    socket.on('requestDbNames', function () {

        db.collection('kahootGames').get()
            .then(snapshot => {
                const gameNamesData = snapshot.docs.map(doc => doc.data());
                socket.emit('gameNamesData', gameNamesData);
            })
            .catch(error => {
                console.error("Error fetching game names:", error);
            });

    });

    // New quiz creation
    socket.on('newQuiz', function (data) {
        db.collection('kahootGames').get()
            .then(snapshot => {
                let num = snapshot.size;
                if (num == 0) {
                    data.id = 1;
                    num = 1;
                } else {
                    data.id = snapshot.docs[num - 1].id + 1;
                }

                const game = data;
                db.collection('kahootGames').doc(data.id.toString()).set(game)
                    .then(() => {
                        socket.emit('startGameFromCreator', num);
                    })
                    .catch(error => {
                        console.error("Error creating new quiz:", error);
                    });
            })
            .catch(error => {
                console.error("Error fetching games:", error);
            });

    });

});
