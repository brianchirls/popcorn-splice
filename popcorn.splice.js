(function( Popcorn, window, document ) {

  "use strict";

  /*
  todo: implement our own controls?
  todo: more events: https://developer.mozilla.org/en-US/docs/DOM/Media_events
  todo: more methods/properties: https://developer.mozilla.org/en-US/docs/DOM/HTMLMediaElement
  todo: seekable, played
  todo: what happens if poster is set before src?
  todo: figure out how many times loadstart is supposed to run and what state should be
  todo: only enable onseeked after on seeking. only enabled onseeking after changecurrenttime

  http://html5doctor.com/html5-audio-the-state-of-play/
  https://developer.apple.com/library/safari/#documentation/AudioVideo/Conceptual/Using_HTML5_Audio_Video/Device-SpecificConsiderations/Device-SpecificConsiderations.html
  http://stackoverflow.com/questions/9241026/popcorn-js-create-a-sequence-of-vimeo-videos?rq=1
  */

  var

  CURRENT_TIME_MONITOR_MS = 16,
  EMPTY_STRING = "",

  MIN_WIDTH = 300,
  MIN_HEIGHT = 200,
  mediaTypes = {
    'webm': 'video',
    'mp4': 'video',
    'm4v': 'video',
    'ogv': {
      media: 'video',
      ext: 'ogg'
    },


    'mp3': 'audio',
    'oga': 'audio',
    'ogg': 'audio',
    'aac': 'audio',
    'wav': 'audio'
  },
  wrappers = {},
  stylesheet,
  aspectRatioStyles = [];

  function refreshWrappers() {
    Popcorn.forEach( Popcorn, function( method, i ) {
      if ( typeof method === 'function' && typeof method._canPlaySrc === 'function' ) {
        wrappers[ i ] = method;
      }
    });
  }

  function guessMediaType( sources ) {
    var ext, i;

    if ( typeof sources === 'string' ) {
      sources = [ sources ];
    }

    for ( i = 0; i < sources.length; i++ ) {
      ext = /\.([a-z]+)($|#)/i.exec( sources[ i ]);
      if ( ext ) {
        ext = ext[ 1 ];
        if ( typeof mediaTypes[ ext ] === "string" ) {
          return mediaTypes[ ext ];
        } else if ( mediaTypes[ ext ] ) {
          return mediaTypes[ ext ].media;
        }
      }
    }

    return false;
  }

  function SplicePlayer( id ) {

    var self = this,
      parent = typeof id === "string" ? Popcorn.dom.find( id ) : id,
      elem,
      impl = {
        src: EMPTY_STRING,
        networkState: self.NETWORK_EMPTY,
        readyState: self.HAVE_NOTHING,
        seeking: false,
        autoplay: EMPTY_STRING,
        preload: EMPTY_STRING,
        controls: false,
        loop: false,
        poster: EMPTY_STRING,
        volume: 1,
        muted: false,
        currentTime: 0,
        duration: NaN,
        ended: false,
        paused: true,
        //width: parent.width|0   ? parent.width  : MIN_WIDTH,
        //height: parent.height|0 ? parent.height : MIN_HEIGHT,
        videoWidth: 0,
        videoHeight: 0,
        error: null,
        cover: false,
        played: false,
        looping: false
      },
      lastTimeUpdate = 0,
      currentTimeInterval,
      lastCurrentTime,
      lastPlayerCurrentTime,
      playPending = false,
      allListeners = {},
      anyListeners = {},
      mediaType,
      currentPlayer,
      currentMedia,
      currentIndex,
      mediaList = [],
      buffered = [{
        start: 0,
        end: 0
      }],
      timeRanges,
      poster;

    function clearAllEvents( name ) {
      var obj, queue = allListeners[ name ];
      if ( !queue ) {
        return;
      }

      while ( queue.length ) {
        obj = queue.pop();
        obj.media.player.removeEventListener( name, obj.callback );
      }
    }

    function listenAllEvents( name, every, each ) {
      var i, queue, obj;

      function makeCallback( obj, queue ) {
        return function( evt ) {
          var i;
          //queue = allListeners[ name ];
          i = queue.indexOf( obj );
          if ( i >= 0 ) {
            queue.splice( i, 1 );
            if ( typeof each === "function" ) {
              each( obj.media, evt );
            }
            if (! queue.length && typeof every === "function" ) {
              every();
            }
          }
        };
      }

      clearAllEvents( name );
      queue = allListeners[ name ];
      if ( !queue ) {
        queue = [];
        allListeners[ name ] = queue;
      }

      for ( i = 0; i < mediaList.length; i++ ) {
        obj = {
          event: name,
          media: mediaList[ i ]
        };
        obj.callback = makeCallback( obj, queue );
        obj.media.player.addEventListener( name, obj.callback, true );
        queue.push( obj );
      }
    }

    function clearAnyEvents( name ) {
      var obj, queue = anyListeners[ name ];
      if ( !queue ) {
        return;
      }

      while ( queue.length ) {
        obj = queue.pop();
        obj.media.player.removeEventListener( name, obj.callback );
      }
    }

    function listenAnyEvent( name, callback, once ) {
      var i, queue, obj;

      function makeCallback( obj ) {
        return function( evt ) {
          var i = queue.indexOf( obj );
          if ( i >= 0 ) {
            if ( once ) {
              clearAnyEvents( name );
            }
            if ( callback ) {
              callback( obj.media, evt );
              return;
            }
            self.dispatchEvent( name );
          }
        };
      }

      if ( typeof callback === 'boolean' ) {
        once = callback;
        callback = null;
      }

      clearAnyEvents( name );
      queue = anyListeners[ name ];
      if ( !queue ) {
        queue = [];
        anyListeners[ name ] = queue;
      }

      for ( i = 0; i < mediaList.length; i++ ) {
        obj = {
          media: mediaList[ i ]
        };
        obj.callback = makeCallback( obj );
        obj.media.player.addEventListener( name, obj.callback, false );
        queue.push( obj );
      }
    }

    function monitorCurrentTime() {
      var currentTime, ended = false, diff;

      if ( !currentPlayer ) {
        return;
      }

      currentTime = currentPlayer.currentTime;

      if ( lastPlayerCurrentTime === currentTime ) {
        return;
      }

      diff = ( currentTime - lastPlayerCurrentTime ) || 0; //todo: double-check this calculation

      currentTime = Math.min( currentTime, currentMedia.to );
      if ( currentTime >= currentMedia.to ) {
        if ( currentIndex + 1 >= mediaList.length ) {
          currentPlayer.pause();
          currentPlayer.currentTime = currentTime; //in case we went a little too far
          ended = true;
        } else {
          currentIndex++;
        }
      } else if ( currentTime < currentMedia.from ) {
        //this should probably never happen, unless the media is playing backwards?
        diff = 0; //todo: make sense of this?
        if ( !currentIndex ) {
          currentPlayer.currentTime = currentMedia.from;
        } else {
            currentIndex--;
            if ( currentIndex < 0 ) {
              currentIndex = 0;
            }
            mediaList[ currentIndex ].player.currentTime = mediaList[ currentIndex ].to;
        }
      }

      if ( mediaList[ currentIndex ] !== currentMedia ) {
        currentPlayer = null;
        if ( currentMedia ) {
          currentMedia.player.pause();
          currentMedia.container.className = "";
        }

        currentMedia = mediaList[ currentIndex ];
        currentMedia.player.currentTime = currentMedia.from + diff;
        currentMedia.container.className = "popcorn-splice-active";
        if ( !impl.paused ) {
          currentMedia.player.play();
        }
        currentPlayer = currentMedia.player;
        self.dispatchEvent( "switchplayer" ); //custom event
      }

      impl.currentTime = currentPlayer.currentTime - currentMedia.from + currentMedia.start;
      impl.currentTime = Math.max( 0, Math.min( impl.currentTime, impl.duration ) );

      if ( impl.currentTime !== lastCurrentTime &&
        ( !currentTimeInterval || Date.now() - lastTimeUpdate >= self._util.TIMEUPDATE_MS ) ) {

        lastTimeUpdate = Date.now();
        self.dispatchEvent( "timeupdate" );
      }

      lastPlayerCurrentTime = currentPlayer.currentTime;
      lastCurrentTime = impl.currentTime;

      if ( ended ) {
        if ( impl.loop ) {
          impl.looping = true;
          self.currentTime = 0;
          if (!self.paused) {
            self.play();
          }
        } else {
          impl.ended = true;
          self.dispatchEvent( "ended" );
        }
      }
    }

    function changeCurrentTime( time ) {
      var i, media;

      if ( ( !impl.duration && time ) || time < 0 || time > impl.duration || isNaN(time) ) {
        throw 'Invalid time';
      }

      lastCurrentTime = impl.currentTime;
      impl.currentTime = time;

      for ( i = 0; i < mediaList.length; i++ ) {
        media = mediaList[ i ];
        if ( media.start <= time && media.end > time ) {
          if ( currentMedia !== media ) {
            currentPlayer = null;
            if ( currentMedia ) {
              currentMedia.player.pause();
              currentMedia.container.className = "";
            }

            lastPlayerCurrentTime = null;
            currentMedia = media;
            currentIndex = i;
            currentMedia.container.className = "popcorn-splice-active";
            currentMedia.player.currentTime = time - media.start + media.from;
            if ( !impl.paused ) {
              currentMedia.player.play();
            }
            currentPlayer = media.player;
            self.dispatchEvent( "switchplayer" ); //custom event
          } else {
            currentPlayer.currentTime = time - media.start + media.from;
          }

          monitorCurrentTime();
          return;
        }
      }
    }

    function destroyPlayer() {
      var i, obj;

      if ( currentTimeInterval ) {
        clearInterval( currentTimeInterval );
        currentTimeInterval = false;
      }

      //todo: fire any events?

      for ( i in allListeners ) {
        clearAllEvents(i);
      }

      for ( i in anyListeners ) {
        clearAnyEvents(i);
      }

      buffered = [
        {
          start: 0,
          end: 0
        }
      ];

      //todo: set networkstate, readystate
      impl.played = false;
      impl.currentTime = 0;
      impl.seeking = false;
      impl.duration = NaN;
      impl.ended = false;
      impl.paused = true;
      impl.error = null;


      while ( mediaList.length ) {
        obj = mediaList.pop();
        obj.player.src = '';
        if ( obj.container && obj.container.parentNode ) {
          obj.container.parentNode.removeChild( obj.container );
        }
      }

      if ( elem && elem.parentNode ) {
        elem.parentNode.removeChild( elem );
      }
    }

    function setUpVideoDimensions() {
      var i, media, aspect, a;

      //calculate videoWidth, videoHeight based on maximum for each source
      for ( i = 0; i < mediaList.length; i++ ) {
        media = mediaList[ i ];
        impl.videoWidth = Math.max( impl.videoWidth, media.width, media.videoWidth );
        impl.videoHeight = Math.max( impl.videoHeight, media.height, media.videoHeight );
      }

      aspect = impl.videoWidth / impl.videoHeight;

      for ( i = 0; i < mediaList.length; i++ ) {
        media = mediaList[ i ];
        a = media.videoWidth / media.videoHeight;
        if ( media.player.videoWidth ) {
          if ( media.player.style ) {
            media.player.style.width = '100%';
            media.player.style.height = '100%';
          } else {
            media.player.width = '100%';
            media.player.height = '100%';
          }
          if ( a <= aspect ) {
            //letterbox
            media.container.style.height = '100%';
            media.container.style.width = a / aspect * 100 + '%';
            media.container.style.left = ( 1 - a / aspect ) * 50 + '%';
          } else {
            //pillarbox
            media.container.style.width = '100%';
            media.container.style.height = aspect / a * 100 + '%';
            media.container.style.top = ( 1 - aspect / a ) * 50 + '%';
          }
        }
      }

    }

    function makeDurationCallback( name, callback, dispatch, once ) {
      function checkDuration( media, evt ) {
        var player, i, m;

        if ( !media.player.duration ) {
          if ( dispatch ) {
            self.dispatchEvent( name );
          }
          return;
        }

        if ( !impl.duration ) {
          for ( i = 0; i < mediaList.length; i++ ) {
            m = mediaList[ i ];
            player = m.player;
            if ( !player.duration ) {
              return;
            } else if ( !m.duration ) {
              m.duration = player.duration;
              m.videoWidth = player.videoWidth || player.width;
              m.videoHeight = player.videoHeight || player.height;
            }
          }
          calculateDuration(true);

          setUpVideoDimensions();
        }

        clearAnyEvents( name );

        if ( dispatch ) {
          listenAnyEvent( name, callback, once );
        }

        if ( callback ) {
          callback( media, evt );
        } else if ( dispatch ) {
          self.dispatchEvent( name );
        }
      }

      listenAnyEvent( name, checkDuration, once );
    }

    function calculateDuration(blockEvent) {
      var i, data,
        oldDuration;

      oldDuration = impl.duration;

      impl.duration = 0;
      for ( i = 0; i < mediaList.length; i++ ) {
        data = mediaList[ i ];
        data.start = impl.duration;
        data.duration = mediaList[ i ].duration;
        data.to = Math.min( data.to, data.duration );

        impl.duration += data.to - data.from;
        data.end = impl.duration;
      }

      if ( !blockEvent && oldDuration !== impl.duration ) {
        self.dispatchEvent( "durationchange" );
      }
    }

    function onAllLoadedMetadata() {

      //todo: scale videos here (also before metadata loaded? and on set height/width)

      impl.networkState = self.NETWORK_IDLE;
      impl.readyState = self.HAVE_METADATA;

      changeCurrentTime( impl.currentTime );

      self.dispatchEvent( "durationchange" );
      self.dispatchEvent( "loadedmetadata" );
      listenAnyEvent( "durationchange", calculateDuration );

      listenAnyEvent( "ended", function () {
        monitorCurrentTime();
      });
    }

    function onProgress( media, evt ) {
      var buff, i, j,
        section, nextSection,
        start, end;

      buff = media.player.buffered;

      if ( buff ) {
        for ( i = 0; i < buff.length; i++ ) {
          start = buff.start( i ) - media.from;
          start = Math.max( 0, start ) + media.start;

          end = buff.end( i ) - media.from;
          end = Math.min( media.to, end );
          end = Math.max( 0, end ) + media.start;
          end = Math.min( media.end, end );

          if (end - start > 0) {
            for (j = buffered.length - 1; j >= 0; j--) {
                section = buffered[ j ];

                if ( start > section.end ) {
                  section = {
                    start: start,
                    end: end
                  };
                  buffered.push( section );
                } else if ( end > section.end ) {
                  section.end = end;
                  if ( start < section.start ) {
                    section.start = start;
                  }
                }

                if ( nextSection && nextSection.start <= section.end ) {
                  //merge overlapping sections
                  section.end = nextSection.end;
                  buffered.splice( j + 1, 1 );
                }

                nextSection = section;
            }

          }
        }
      }

      self.dispatchEvent( "progress" );
    }

    function onSeeked( media, evt ) {
      if ( media.player === currentPlayer ) {
        if ( impl.looping && impl.paused ) {
          impl.looping = false;
        }
        self.dispatchEvent( "seeked" );
      }
    }

    function onSeeking( media, evt ) {
      if ( media.player === currentPlayer ) {
        self.dispatchEvent( "seeking" );
      }
    }

    function setPoster( src ) {
      if ( impl.played ) {
        return;
      }

      //swap out old poster
      if ( poster && poster.parentNode ) {
        poster.parentNode.removeChild( poster );
      }

      if ( !src || typeof src !== "string" ) {
        return;
      }

      poster = document.createElement( "img" );
      poster.style.position = 'absolute';
      //todo: scale poster
      poster.src = src;
      elem.appendChild( poster );
    }

    function changeSrc( src ) {

      function makeMediaPlayer( param ){
        var i, j, sources, source, html, wrapper,
          parsedUri;

        if (!param.container) {
          param.container = document.createElement('div');
        }

        sources = param.src;
        for ( i = 0; i < sources.length; i++ ) {
          source = sources[ i ];

          for ( j in wrappers ) {
            wrapper = wrappers[ j ];
            if ( Popcorn.SplicePlayer !== wrapper && wrapper._canPlaySrc( source ) ) {
              param.player = wrapper( param.container );

              if ( param.width ) {
                param.player.width = param.width;
              }
              if ( param.height ) {
                param.player.height = param.height;
              }

              parsedUri = self._util.parseUri( source );

              //special cases
              if ( j === "HTMLYouTubeVideoElement" ) {
                source += ( parsedUri.query && "&" || "?" ) + "wmode=opaque";
              }

              // Set src, but not until after we return the media so the caller
              // can get error events, if any.
              setTimeout(function() {
                param.player.src = source;
              }, 0);
              return param;
            }
          }

          /*
          //no available wrapper. check popcorn players
          for (i in Popcorn.player.registry ) {
            if ( Popcorn.player.registry.hasOwnProperty( i ) ) {
              if ( Popcorn.player.registry[ i ].canPlayType( param.container.nodeName, source ) ) {
                return Popcorn[ i ]( param.container, source, options );
              }
            }
          }
          */
        }

        //no wrappers available, so make a native element
        if ( !mediaType ) {
          mediaType = guessMediaType( sources ) || 'video';
        }

        html = '<video';
        if ( impl.preload ) {
          html +=' preload="auto" autobuffer';
        }
        html += '>';
        for ( i = 0; i < sources.length; i++ ) {
          source = sources[ i ];
          source = source.replace( /#.*$/, '' );
          if ( param.from || param.to > param.from ) {
            source += '#t=' + param.from;
            if ( param.to > param.from ) {
              source += ',' + param.to;
            }
          }
          html += '<source src="' + source + '">';
        }
        html += "</video>";
        wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        param.player = wrapper.firstChild;
        param.container.insertBefore( param.player, poster );

        return param;
      }

      function processMediaParameter( src ) {
        var param;

        if ( typeof src === 'string' ) {
          param = {
            src: [src]
          };
        } else if ( Popcorn.isArray( src ) && src.length ) {
          param = {
            src: src.slice()
          };
        } else if ( src && typeof src === 'object' ) {
          param = Popcorn.extend( {}, src );
          if ( !param.src ) {
            return false;
          }
          if ( typeof param.src === 'string' ) {
            param.src = [ param.src ];
          }
        } else {
          return false;
        }

        param.from = parseFloat( param.from ) || 0;
        param.from = Math.max( param.from, 0 );
        param.to = parseFloat( param.to );
        if ( !param.to || param.to < param.from ) {
          param.to = Infinity;
        }

        param.width = parseFloat( param.width ) || impl.width || false;
        if ( param.width < 0 ) {
          param.width = 0;
        }
        param.height = parseFloat( param.height ) || impl.height || false;
        if ( param.height < 0 ) {
          param.height = 0;
        }

        return makeMediaPlayer( param );
      }

      //todo: put these variables at the top or make init function
      var i, media = [], param, player, style, src;

      if( !self._canPlaySrc( src ) ) {
        impl.error = {
          name: "MediaError",
          message: "Media Source Not Supported",
          code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        };
        self.dispatchEvent( "error" );
        return;
      }

      //make sure videos exist in a container that's position:relative
      /*
      style = window.getComputedStyle( parent );
      if ( style.getPropertyValue( 'position' ) !== 'relative' ) {
        elem = document.createElement( 'div' );
        elem.style.display = 'relative';
        parent.appendChild( elem );
        parent = elem;
      }
      if ( style.getPropertyValue( 'background-color' ) === 'rgba(0, 0, 0, 0)' ) {
        parent.style.backgroundColor = 'black';
      }
      */

      destroyPlayer();

      elem = document.createElement( 'div' );
      elem.className = "popcorn-splice-player";
      parent.appendChild( elem );

      impl.src = src;

      if ( !Popcorn.isArray( src ) ) {
        src = ( src && [ src ] ) || [];
      }

      for ( i = 0; i < src.length; i++ ) {
        param = processMediaParameter( src[ i ] );
        if ( param ) {
          media.push( param );

          player = param.player;
          player.preload = impl.preload;
          player.volume = impl.volume;
          player.muted = impl.muted;
          player.autoplay = 0;
          player.controls = false;

          elem.appendChild( param.container );

        }
      }

      //todo: compare media with mediaList to see if the list has changed, put cleanup after this

      mediaList = media;
      if ( !mediaList.length ) {
        return;
      }
      makeDurationCallback( "loadeddata", null, true );
      makeDurationCallback( "loadstart", null, true );
      makeDurationCallback( "progress", onProgress, true );
      makeDurationCallback( "loadedmetadata" );
      listenAllEvents( "loadedmetadata", onAllLoadedMetadata );

      listenAnyEvent( "suspend" );
      listenAnyEvent( "waiting" );
      listenAnyEvent( "error" );

      listenAllEvents( "canplay", null, function( media, evt ) {
        if ( media !== currentMedia && allListeners.canplay.length ) {
          return;
        }

        clearAllEvents( "canplay" );

        impl.readyState = self.HAVE_FUTURE_DATA;
        self.dispatchEvent( "canplay", evt );

        //todo: actually calculate this
        impl.readyState = self.HAVE_ENOUGH_DATA;
        self.dispatchEvent( "canplaythrough" );

        // Auto-start if necessary
        if( impl.autoplay ) {
          self.play();
        }
      }, false);

      listenAnyEvent( "playing", function( media ){
        if ( media.player !== currentPlayer ) {
          return;
        }

        if ( impl.looping ) {
          impl.looping = false;
          return;
        }

        if ( !impl.played ) {
          setPoster();
          impl.played = true;
        }

        impl.paused = false;
        self.dispatchEvent( "playing" );
      });

      listenAnyEvent( "play", function( media ){
        if ( !currentTimeInterval ) {
          currentTimeInterval = setInterval( monitorCurrentTime, CURRENT_TIME_MONITOR_MS );
          monitorCurrentTime();
        }

        if ( impl.looping ) {
          impl.looping = false;
          return;
        }

        if ( media.player !== currentPlayer ) {
          return;
        }

        if ( !impl.played ) {
          setPoster();
          impl.played = true;
        }
        impl.paused = false;
        self.dispatchEvent( "play" );
      });

      listenAnyEvent( "pause", function( media ){
        if ( impl.paused || media.player !== currentPlayer ||
          impl.looping || impl.loop && currentPlayer.currentTime >= currentPlayer.duration ) {

          return;
        }
        impl.paused = true;
        self.dispatchEvent( "pause" );
      });

      listenAnyEvent( "volumechange", function( media ){
        var i, m;
        if ( media.player.volume !== impl.volume || media.player.muted !== impl.muted ) {
          impl.volume = media.player.volume;
          impl.muted = media.player.muted;
          for ( i = 0; i < mediaList.length; i++ ) {
            m = mediaList[ i ];
            if ( m !== media ) {
              m.player.muted = media.player.muted;
              m.player.volume = media.player.volume;
            }
          }
          self.dispatchEvent( "volumechange" );
        }
      });

    }

    if ( !stylesheet ) {
      // styles based on http://www.alistapart.com/articles/creating-intrinsic-ratios-for-video/
      stylesheet = document.createElement( "style" );
      stylesheet.appendChild( document.createTextNode(
        ".popcorn-splice-player {\n" +
        "  position: relative;\n" +
        "  padding-bottom: 56.25%;\n" + //temp
        "  background: black;\n" + //temp
        "  height: 0;\n" +
        "}\n" +
        ".popcorn-splice-player > div {\n" +
        "  position: absolute;\n" +
        "  top: 0;\n" +
        "  left: 0;\n" +
        "  width: 100%;\n" +
        "  height: 100%;\n" +
        "  visibility: hidden;\n" +
        "  opacity: 0;\n" +
        "}\n" +
        ".popcorn-splice-player > div.popcorn-splice-active {\n" +
        "  visibility: visible;\n" +
        "  opacity: 1;\n" +
        "}\n"
      ) );
      document.head.appendChild( stylesheet );
    }

    // Namespace all events we'll produce
    self._eventNamespace = Popcorn.guid( "SplicePlayer::" );

    self.parentNode = parent;

    //so the original doesn't get modified
    self._util = Popcorn.extend( {}, self._util );

    self._util.type = "Splice";

    //refresh available wrappers
    refreshWrappers();

    self._util.players = function () {
      var i, a = [];
      for ( i = 0; i < mediaList.length; i++ ) {
        a.push( mediaList[ i ].player );
      }
      return a;
    };

    self._util.currentPlayer = function () {
      return currentPlayer || null;
    };

    self._util.destroy = function () {
      destroyPlayer();
    };

    self.play = function() {
      if ( !impl.duration ) {
        if ( !playPending ) {
          playPending = function () {
            self.removeEventListener( "canplay", playPending );
            playPending = false;
            self.play();
          };
          self.addEventListener( "canplay", playPending );
        }
        return;
      }

      if ( !currentTimeInterval ) {
        currentTimeInterval = setInterval( monitorCurrentTime, CURRENT_TIME_MONITOR_MS );
      }

      changeCurrentTime( impl.currentTime );
      if ( currentPlayer ) {
        if ( impl.ended || impl.currentTime >= impl.duration ) {
          impl.ended = false;
          changeCurrentTime( 0 );
        }
        currentPlayer.play();
      }
    };

    self.pause = function() {
      if ( playPending ) {
        self.removeEventListener( "canplay", playPending );
        playPending = false;
      }
      if ( currentPlayer ) {
        currentPlayer.pause();
      } else {
        impl.paused = true;
      }
    };

    timeRanges = {
      start: function( index ) {
        if ( index >= buffered.length || index < 0 ) {
          //throw fake DOMException/INDEX_SIZE_ERR
          throw "INDEX_SIZE_ERR: DOM Exception 1";
        }

        return buffered[ index ].start;
      },

      end: function( index ) {
          if ( index >= buffered.length || index < 0 ) {
            //throw fake DOMException/INDEX_SIZE_ERR
            throw "INDEX_SIZE_ERR: DOM Exception 1";
          }

          return buffered[ index ].end;
      }
    };
    Object.defineProperties( timeRanges, {
      length: {
        get: function() {
          return buffered.length;
        }
      }
    } );

    Object.defineProperties( self, {

      src: {
        get: function() {
          return impl.src;
        },
        set: function( aSrc ) {
          changeSrc( aSrc );
        }
      },

      autoplay: {
        get: function() {
          return impl.autoplay;
        },
        set: function( aValue ) {
          impl.autoplay = self._util.isAttributeSet( aValue );
        }
      },

      loop: {
        get: function() {
          return impl.loop;
        },
        set: function( aValue ) {
          impl.loop = self._util.isAttributeSet( aValue );
        }
      },

      width: {
        get: function() {
          return elem.width || 0;
        },
        set: function( aValue ) {
          //todo: type check
          impl.width = aValue;
          if ( parent ) {
            parent.style.width = impl.width + "px";
          }
        }
      },

      height: {
        get: function() {
          return elem.height || 0;
        },
        set: function( aValue ) {
          //todo: make this not suck
          //todo: type check
          impl.height = aValue;
          if ( parent ) {
            parent.style.height = impl.height + "px";
          }
        }
      },

      videoWidth: {
        get: function() {
          return impl.videoWidth || 0;
        }
      },

      videoHeight: {
        get: function() {
          return impl.videoHeight || 0;
        }
      },

      currentTime: {
        get: function() {
          return impl.currentTime;
        },
        set: function( aValue ) {
          if ( aValue > 0 ) {
            setPoster();
          }

          if ( !anyListeners.seeking ) {
            listenAnyEvent( "seeking", onSeeking );
            listenAnyEvent( "seeked", onSeeked );
          }

          changeCurrentTime( aValue );
        }
      },

      poster: {
        get: function() {
          return impl.poster;
        },
        set: function( aValue ) {
          impl.poster = aValue;
          setPoster( aValue );
        }
      },

      duration: {
        get: function() {
          return impl.duration;
        }
      },

      ended: {
        get: function() {
          return impl.ended;
        }
      },

      paused: {
        get: function() {
          return impl.paused;
        }
      },

      seeking: {
        get: function() {
          return impl.seeking;
        }
      },

      readyState: {
        get: function() {
          return impl.readyState;
        }
      },

      networkState: {
        get: function() {
          return impl.networkState;
        }
      },

      volume: {
        get: function() {
          return impl.volume;
        },
        set: function( aValue ) {
          var i, media;

          aValue = parseFloat( aValue );
          if( aValue < 0 || aValue > 1 || isNaN( aValue ) ) {
            throw "Volume value must be between 0.0 and 1.0";
          }

          if ( impl.volume === aValue ) {
            return;
          }

          impl.volume = aValue;
          for ( i = 0; i < mediaList.length; i++ ) {
            media = mediaList[ i ];
            media.player.volume = aValue;
          }
          if ( mediaList.length ) {
            self.dispatchEvent( "volumechange" );
          }
        }
      },

      muted: {
        get: function() {
          return impl.muted;
        },
        set: function( aValue ) {
          var i, media, muted = !!self._util.isAttributeSet( aValue );
          if ( impl.muted === muted ) {
            return;
          }

          impl.muted = muted;
          for ( i = 0; i < mediaList.length; i++ ) {
            media = mediaList[ i ];
            media.player.volume = muted;
          }
          if ( mediaList.length ) {
            self.dispatchEvent( "volumechange" );
          }
        }
      },

      buffered: {
        get: function () {
          return timeRanges;
        }
      },

      style: {
        get: function () {
          return elem.style;
        }
      },

      error: {
        get: function() {
          return impl.error;
        }
      }
    });
  }

  SplicePlayer.prototype = new Popcorn._MediaElementProto();
  SplicePlayer.prototype.constructor = SplicePlayer;

  // Helper for identifying URLs we know how to play.
  SplicePlayer.prototype._canPlaySrc = function( url ) {
    var i, wrapper, canPlay = 0,
      levels = [
        EMPTY_STRING,
        "maybe",
        "probably"
      ],
      mediaType;

    if ( typeof url === "string" ) {
      mediaType = /\.([a-z]+)($|#)/i.exec( url );
      mediaType = mediaType && mediaType[ 1 ] || "";
      if ( mediaTypes[ mediaType ] ) {
        if ( typeof mediaTypes[ mediaType ] === "string" ) {
          mediaType = mediaTypes[ mediaType ] + "/" + mediaType;
        } else {
          mediaType = mediaTypes[ mediaType ];
          mediaType = mediaType.media + "/" + mediaType.ext;
        }
        canPlay = levels.indexOf( this.canPlayType( mediaType ) ); //this calls refreshWrappers
        if ( canPlay >= 2 ) {
          return "probably";
        }
      } else {
        mediaType = "";
        refreshWrappers();
      }

      for ( i in wrappers ) {
        if ( wrappers.hasOwnProperty( i ) && wrappers[ i ] !== Popcorn.SplicePlayer ) {
          wrapper = wrappers[ i ];
          if ( typeof wrapper._canPlaySrc === 'function' ) {
            canPlay = Math.max( canPlay, levels.indexOf( wrapper._canPlaySrc( url ) ) );
            if ( canPlay >= 2 ) {
              return "probably";
            }
          }
        }
      }

    } else if ( Popcorn.isArray( url ) ) {
      canPlay = 2;
      for ( i = 0; i < url.length; i++ ) {
        canPlay = Math.min( canPlay, levels.indexOf( this._canPlaySrc( url[ i ] ) ) );
        if ( !canPlay ) {
          return "";
        }
      }
    } else if ( url && typeof url === 'object' ) {
      if ( Popcorn.isArray( url.src ) ) {
        for ( i = 0; i < url.src.length; i++ ) {
          canPlay = Math.max( canPlay, levels.indexOf( this._canPlaySrc( url.src[ i ] ) ) );
        }
      } else {
        return this._canPlaySrc( url.src );
      }
    }
    return levels[ canPlay ] || EMPTY_STRING;
  };

  // We'll attempt to support a mime type of video/x-vimeo
  SplicePlayer.prototype.canPlayType = function( type ) {
    var video = document.createElement( 'video' ), canPlay = 0,
      div,
      i, wrapper,
      levels = [
        EMPTY_STRING,
        "maybe",
        "probably"
      ];

    canPlay = levels.indexOf( video.canPlayType( type ) );
    if ( canPlay >= 2 ) {
      return "probably";
    }

    refreshWrappers();

    div = document.createElement( "div" );
    for ( i in wrappers ) {
      if ( wrappers.hasOwnProperty( i ) && wrappers[ i ] !== Popcorn.SplicePlayer ) {
        wrapper = wrappers[ i ]( div );
        if ( typeof wrapper.canPlayType === 'function' ) {
          canPlay = Math.max( canPlay, levels.indexOf( wrapper.canPlayType( type ) ) );
          if ( canPlay >= 2 ) {
            return "probably";
          }
        }
      }
    }

    return levels[ canPlay ];
  };

  Popcorn.SplicePlayer = function( id ) {
    return new SplicePlayer( id );
  };
  Popcorn.SplicePlayer._canPlaySrc = SplicePlayer.prototype._canPlaySrc;

}( Popcorn, window, document ));
