// NPM REQUIRES
const { Pool, Client } = require('pg');
const fs = require('fs');
const parse = require('csv-parse');
const async = require('async');
const moment = require('moment');

// LOCAL IMPORTS
const Utils = require('../libs/utils.js');

// CONFIGURE POSTGRES POOL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// RUNTIME VARIABLES
var tweets = [];

if (Utils.checkForMissingEnvVars(["DATABASE_URL", "PATH_CSV"])) {
  process.exit();
}

async.waterfall([
  function(callback) {
    pool.query("DROP TABLE IF EXISTS tweets;", [], function(err, res) {
      if (err) { throw err; }

      callback(null);
    });
  },
  function(callback) {
    pool.query('CREATE TABLE "public"."tweets" ("id" serial, "twitter_id" text, "text" text, "timestamp" text, "is_deleted" boolean, PRIMARY KEY ("id"), UNIQUE ("id"));', [], function(err, res) {
      if (err) { throw err; }

      callback(null);
    });
  },
  function(callback) {
    fs.readFile(process.env.PATH_CSV, function (err, data) {
      if (err) { throw err; }
      callback(null, data);
    });
  },
  function(_csvFileRaw, callback) {
    parse(_csvFileRaw.toString(), {}, function(err, data) {
      callback(null, data);
    });
  },
  function(_csvFile, callback) {
    _csvFile.forEach(function(row, index) {
      if (index !== 0) {
        var tweetId = row[0];
        var timestamp = row[3];
        var text = row[5];

        tweets.push({
          "tweetId": tweetId,
          "timestamp": moment(timestamp, "YYYY-MM-DD HH:mm:ss ZZ").format("x"),
          "text": text
        });
      }
    });

    createTweetRows(tweets, callback);
  },
  function(callback) {
    console.log("Done");
  }
]);

function createTweetRows(tweets, parentCallback) {
  var tweet = tweets[0];

  async.waterfall([
    function(callback) {
      pool.query("INSERT INTO tweets(twitter_id, text, timestamp, is_deleted) VALUES($1, $2, $3, false)", [ tweet.tweetId, tweet.text, tweet.timestamp ], function(err, res) {
        if (err) { throw err; }
        callback(null);
      });
    },
    function() {
      tweets.shift();

      if (tweets.length === 0) {
        parentCallback(null);
      } else {
        createTweetRows(tweets, parentCallback);
      }
    }
  ]);
}
