$(function () {
  "use strict";

  var socket = io();
  var pageLoaded = false;
  var showDeletedNext = false;
  var cursorPos = null;
  var autoBackspace;
  var autoBackspaceActive = false;
  var isRateLimitHit = false;
  var allowTransitionAwayFromRateLimit = false;
  var showSomeoneElseDeleting = false;
  var timerResetSomeoneElseDeleting;
  var allowTransitionToOccupiedYou = true;
  var timerOccupiedYou;
  var allowResize = false;

  // FUNCTIONS
  function changeFooterMessage(elemId) {
    if ($(window).width() < 1224) {
      $("footer p.main").fadeOut(150, function() {
        $(".message").hide();
        $(elemId).show();
        $("footer p.main").fadeIn(150);
      });
    }

    $("#welcome-message p").fadeOut(150, function() {
      $("#welcome-message span").hide();
      $("#welcome-message " + elemId).show();
      $("#welcome-message p").fadeIn(150);
    });
  }

  function sendEmitDelete() {
    if ($("#tweets .tweet").length === 0) {
      return;
    }

    socket.emit("charDelete");
  }

  function startBackspace() {
    if (!autoBackspaceActive) {
      autoBackspaceActive = true;

      sendEmitDelete();

      autoBackspace = setInterval(sendEmitDelete, 100);
    }
  }

  function endBackspace() {
    clearInterval(autoBackspace);
    autoBackspaceActive = false;
  }

  function checkNudge() {
    if ($(window).width() < 1224) {
      return;
    }

    if ($("#welcome-message-overlay").overlaps(".cursor").length > 0) {
      $("#welcome-message").removeClass("unnudge");
      $("#welcome-message").addClass("nudge");
    } else {
      $("#welcome-message").removeClass("nudge");
      $("#welcome-message").addClass("unnudge");
    }
  }

  // SOCKET.IO EVENTS
  socket.on("refreshState", function(payload) {
    checkNudge();

    $("#tweets span").remove();

    // Add a counter showing how many tweets are left
    var spanCounterLeft = $("<span>");
    spanCounterLeft.addClass("counter-left");
    if (parseInt(payload.tweetsRemaining) === 1) {
      spanCounterLeft.text(payload.tweetsRemaining + " Tweet left");
    } else {
      spanCounterLeft.text(payload.tweetsRemaining + " Tweets left");
    }

    if (parseInt(payload.tweetsRemaining) !== 0) {
      $("#tweets").append(spanCounterLeft);
    }

    // Add each tweet to the page
    payload.backlog.forEach(function(tweet, index) {
      var spanTweet = $("<span>");
      spanTweet.addClass("tweet");

      var spanTimestamp = $("<span>");
      spanTimestamp.addClass("timestamp");
      spanTimestamp.text(tweet.timestamp);

      var aTweetLink = $("<a>");
      aTweetLink.attr("href", "https://twitter.com/ihutc/status/" + tweet.id);
      aTweetLink.attr("target", "_blank");
      aTweetLink.text(tweet.text);

      spanTweet.append(spanTimestamp);
      spanTweet.append(aTweetLink);

      $("#tweets").append(spanTweet);
    });

    // Add cursor
    $("#tweets .cursor").remove();

    var spanCursor = $("<span>");
    spanCursor.addClass("cursor");
    spanCursor.text("|");

    $("#tweets").append(spanCursor);

    // Specially format the final tweet
    $("#tweets .tweet").last().addClass("last");

    // Animate the "Deleted!" graphic
    if (showDeletedNext) {
      showDeletedNext = false;

      if (cursorPos === null) {
        cursorPos = $(".cursor").offset();
      }

      $("#deleted").show().css({
        "opacity": 1,
        "top": cursorPos.top,
        "left": cursorPos.left
      }).stop().animate({
        "opacity": 0,
        "top": $("#deleted").offset().top - 50
      }, 1000, function() {
        $("#deleted").attr("style", "");
        cursorPos = null;
      });
    }

    // If there's only one character left in the current tweet,
    // line up the "Deleted!" animation
    if ($("#tweets .tweet a").last().text().length === 1 && !showDeletedNext) {
        showDeletedNext = true;
    }

    if (!pageLoaded) {
      // Do things when the page is loaded for the first time
      pageLoaded = true;

      $("#tweets").css({
        "min-height": parseInt($(window).height()) - parseInt($("footer").outerHeight(true)) - parseInt($("#tweets").css("margin-bottom")) - parseInt($("#tweets").css("margin-top"))
      });

      $("#tweets").delay(1500).animate({ opacity: 1 }, 750);

      $("html, body").delay(1500).animate({
        scrollTop: $(document).height() - $(window).height()
      }, 750, function() {
        $("footer").animate({ opacity: 1 }, 250, function() {
          $("#content").css({
            "height": $(window).height(),
            "scrollTop": "100px",
            "overflow": "hidden"
          });

          $("#meta").remove();

          $("#content")[0].scrollTop = $("#content")[0].scrollHeight;

          $("#welcome-message").delay(400).animate({
            "opacity": 1
          }, 250, function() {
            checkNudge();
          });

          allowResize = true;
        });
      });
    } else {
      $("#content")[0].scrollTop = $("#content")[0].scrollHeight;
    }

    // Show a message if all tweets have been deleted
    if (payload.backlog.length === 0) {
      var spanNothingToDelete = $("<span>");
      spanNothingToDelete.addClass("nothing-to-delete");
      spanNothingToDelete.text("Nothing to delete.");

      $("#tweets").append(spanNothingToDelete);
    }
  });

  socket.on("rateLimitHit", function() {
    if (!isRateLimitHit) {
      isRateLimitHit = true;
      allowTransitionAwayFromRateLimit = true;

      changeFooterMessage(".message-rate-limit");
    }
  });

  socket.on("currentPerson", function(data) {
    if (data.id === socket.id) {
      if (allowTransitionAwayFromRateLimit) {
        allowTransitionAwayFromRateLimit = false;
        changeFooterMessage(".message-normal");
        isRateLimitHit = false;
      }

      clearTimeout(timerOccupiedYou);

      if (allowTransitionToOccupiedYou) {
        allowTransitionToOccupiedYou = false;
        changeFooterMessage(".message-occupied-you");
      }

      timerOccupiedYou = setTimeout(function() {
        if (!$(".message-rate-limit").is(":visible")) {
          changeFooterMessage(".message-normal");
        }

        allowTransitionToOccupiedYou = true;
      }, 1000);
    } else {
      clearInterval(timerResetSomeoneElseDeleting);

      if (!isRateLimitHit) {
        timerResetSomeoneElseDeleting = setTimeout(function() {
          changeFooterMessage(".message-normal");
          showSomeoneElseDeleting = false;
        }, 1000);

        if (!showSomeoneElseDeleting) {
          showSomeoneElseDeleting = true;
          changeFooterMessage(".message-occupied");
        }
      }
    }
  });

  // EVENT HANDLERS
  $("#backspace-button").bind("click", function(e) {
    e.preventDefault();
  });

  $("body").keydown(function(e) {
    if (e.keyCode === 8) {
      e.preventDefault();
      startBackspace();
    }
  });

  $("body").keyup(function(e) {
    if (e.keyCode === 8) {
      e.preventDefault();
      endBackspace();
    }
  });

  $("#backspace-button").bind("touchstart mousedown", function(e) {
    e.preventDefault();
    startBackspace();
  });

  $("#backspace-button").bind("touchend mouseup", function(e) {
    e.preventDefault();
    endBackspace();
  });

  $("#button-about").click(function(e) {
    e.preventDefault();
    $("body").addClass("about-active");
    $("#about").fadeIn(150);
    $("#overlay").addClass("active");
    $("body")[0].scrollTop = 0;
  });

  $("#about #close").click(function(e) {
    e.preventDefault();
    $("body").removeClass("about-active");
    $("#about").fadeOut(150);
    $("#overlay").removeClass("active");
    $("body")[0].scrollTop = $("body")[0].scrollHeight;
  });

  function redraw() {
    if (!allowResize) {
      return;
    }

    $("#content").css({
      "height": $(window).height(),
      "overflow": "hidden"
    });

    $("#content")[0].scrollTop = $("#content")[0].scrollHeight;
    $("body")[0].scrollTop = $("body")[0].scrollHeight;
  }

  // WINDOW RESIZE
  $(window).on("resize", function() {
    if (!$("body").hasClass("about-active")) {
      redraw();
    }
  });

  $(window).on("orientationchange", function() {
    redraw();
  });
});
