// REQUIRES
const nunjucks = require('nunjucks');
const express = require('express');
const path = require('path');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const { Pool, Client } = require('pg');
const async = require('async');
const yaml = require('yamljs');
const helmet = require('helmet');
const twitter = require('twitter');
const moment = require('moment');
const _ = require('lodash');
const GraphemeSplitter = require('grapheme-splitter');
const FastRateLimit = require('fast-ratelimit').FastRateLimit;
const request = require('request');
const validateIP = require('validate-ip-node');

// LOCAL IMPORTS
const Utils = require('./libs/utils.js');

// CONFIG
const settings = yaml.load('settings.yaml');
const BACKLOG_SIZE = 50;

// SECURITY
app.use(helmet());

var messageLimiter = new FastRateLimit({
  threshold: 300,
  ttl: 900
});

// RUNTIME VARIABLES
var splitter = new GraphemeSplitter();
var client = new twitter({
  consumer_key: process.env.CONSUMER_KEY,
  consumer_secret: process.env.CONSUMER_SECRET,
  access_token_key: process.env.ACCESS_TOKEN_KEY,
  access_token_secret: process.env.ACCESS_TOKEN_SECRET
});
var backlog = [];
var allowDelete = true;
var tweetsRemaining = 0;

// CONFIGURE POSTGRES
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// GENERAL FUNCTIONS
function sendMessage(message, priority) {
  if (priority === "high") {
    priority = "1";
  } else if (priority === "normal") {
    priority = "0";
  } else if (priority === "low") {
    priority = "-2";
  }

  request.post({
    url: "https://api.pushover.net/1/messages.json",
    body: `token=${process.env.PUSHOVER_APP_TOKEN}&user=${process.env.PUSHOVER_USER}&message=${message}&priority=${priority}`
  });
}

function getBacklog(parentCallback) {
  async.waterfall([
    function(callback) {
      pool.query("SELECT COUNT(*) FROM tweets WHERE is_deleted IS FALSE;", [], function(err, res) {
        tweetsRemaining = res.rows[0].count;
        callback(null);
      });
    },
    function() {
      pool.query("SELECT * FROM tweets WHERE is_deleted IS FALSE ORDER BY id ASC LIMIT $1", [ BACKLOG_SIZE ], function(err, res) {
        backlog = [];

        res.rows.forEach(function(row, index) {
          var timestamp = moment(parseInt(row.timestamp));

          if (timestamp.isAfter("2010-11-05")) {
            timestamp = timestamp.format("YYYY-MM-DD HH:mm:ss");
          } else {
            timestamp = timestamp.format("YYYY-MM-DD");
          }

          backlog.push({
            "id": row.twitter_id,
            "text": row.text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
            "timestamp": timestamp
          });
        });

        _.reverse(backlog);

        if (parentCallback) {
          parentCallback(null);
        }
      });
    }
  ]);
}

function emitRefreshState() {
  io.sockets.emit("refreshState", {
    "backlog": backlog,
    "tweetsRemaining": tweetsRemaining
  });
}

function deleteCharacter(socket) {
  if (parseInt(tweetsRemaining) === 0) {
    return;
  }

  var ipAddress = socket.request.headers['x-forwarded-for'] || socket.request.connection.remoteAddress;

  if (!validateIP(ipAddress)) {
    return;
  }

  if (messageLimiter.consumeSync(ipAddress) === false) {
    socket.emit("rateLimitHit");
    return;
  }

  if (!allowDelete) {
    return;
  }

  async.waterfall([
    function(callback) {
      allowDelete = false;

      // Convert current tweet text into graphemes (single characters)
      var graphemes = splitter.splitGraphemes(backlog[backlog.length - 1].text);

      // Remove last character
      graphemes.pop();

      // Update current tweet text in backlog array
      backlog[backlog.length - 1].text = graphemes.join('');

      // If the last character has been removed, delete the tweet
      if (graphemes.length === 0) {
        var id = backlog[backlog.length - 1].id;

        client.post('statuses/destroy', { id: id }, function(err, tweets, response) {
          if (err) {
            sendMessage(`Error: Twitter API error for ${id}`, "high");
            callback(err);
            return;
          }

          sendMessage(`Tweet deleted`, "normal");
          callback(null, id);
        });
      } else {
        callback(null, null);
      }
    },
    function(_tweetDeletedId, callback) {
      if (_tweetDeletedId) {
        backlog.pop();

        pool.query("UPDATE tweets SET is_deleted = TRUE WHERE twitter_id = $1", [ _tweetDeletedId ], function(err, res) {
          if (err) {
            sendMessage(`Error: Postgres error for ${_tweetDeletedId}`, "high");
            callback(err);
            return;
          }

          tweetsRemaining--;

          callback(null);
        });
      } else {
        callback(null);
      }
    },
    function(callback) {
      // If backlog is empty, get more tweets
      if (backlog.length === 0) {
        getBacklog(callback);
      } else {
        callback(null);
      }
    },
    function(callback) {
      io.sockets.emit("currentPerson", { id: socket.conn.id });

      emitRefreshState();

      callback(null);
    }
  ],
  function(_err) {
    if (_err) {
      console.log("ERROR:", _err);
    }

    allowDelete = true;
  });
}

// SOCKET.IO
io.on("connection", function(socket) {
  emitRefreshState();

  socket.on("charDelete", function(data) {
    deleteCharacter(socket);
  });
});

// STARTUP
if (Utils.checkForMissingEnvVars([
  "DATABASE_URL", "CONSUMER_KEY", "CONSUMER_SECRET",
  "ACCESS_TOKEN_KEY", "ACCESS_TOKEN_SECRET", "PUSHOVER_APP_TOKEN",
  "PUSHOVER_USER"
])) {
  process.exit();
}

getBacklog();

// CONFIGURE SERVER
app.set('port', process.env.PORT || 3000);
app.set('view engine', 'html');
app.use('/public', express.static(path.join(__dirname, 'public')));

// CONFIGURE NUNJUCKS
nunjucks.configure('views', {
  autoescape: true,
  express: app
});

// VIEWS
app.get('/', function(req, res) {
  res.render('index', { settings });
});

app.get('/pgp', function(req, res) {
  res.redirect('/public/pgp.txt');
});

// START SERVER
http.listen(app.get('port'), function() {
  console.log(settings.title);
  console.log("Available at http://localhost:" + app.get('port'));
  console.log("-------");
});
