/*jslint devel: true, bitwise: true, browser: true, white: true, nomen: true, plusplus: true, maxerr: 50, indent: 4 */
/* global module, test, asyncTest, expect, ok, equal, start, stop, Popcorn */
var testData;
( function() {
  "use strict";

  // Find a suitable video source for this browser.
  var videoSource = (function() {

    var v = document.createElement( "video" ),
      sources = [
        {
          type: "video/webm",
          file: "trailer.webm"
        },
        {
          type: "video/mp4",
          file: "trailer.mp4"
        },
        {
          type: "video/ogg",
          file: "trailer.ogv"
        }
      ],
      source,
      sourcesLength = sources.length;

    while( sourcesLength-- ) {
      source = sources[ sourcesLength ];
      if( v.canPlayType( source.type ) !== "" ) {
        return source;
      }
    }

    throw "No Supported Media Types found for this browser.";

  }());

  var players = [];

  var testData = {

    videoSrc: videoSource.file,
    videoType: videoSource.type,
    expectedDuration: 64.544,

    createMedia: function( id ) {
      var player = Popcorn.SplicePlayer( id );
      players.push( player );
      return player;
    },
    playerSpecificAsyncTests: function() {
      //module( "SplicePlayer" );
      test( "Core", function() {
        expect( 2 );

        ok( window.Popcorn.SplicePlayer, "Popcorn.SplicePlayer exists" );

        equal( typeof window.Popcorn.SplicePlayer, "function", "Popcorn.SplicePlayer is a function" );
      } );
    }
  };

  var qunitStart = window.start;
  window.start = function() {
    // Give the video time to finish loading so callbacks don't throw
    setTimeout( function() {
      var video,
        player;

      qunitStart();

      while ( players.length ) {
        player = players.pop();
        player._util.destroy();
      }

      video = document.querySelector( "#video" );
      while( video.hasChildNodes() ) {
        video.removeChild( video.lastChild );
      }
    }, 500 );
  };


  window.testData = testData;

}() );
