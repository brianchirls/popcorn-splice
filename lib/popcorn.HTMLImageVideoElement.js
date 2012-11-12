(function( Popcorn, window, document ) {

  "use strict";

  /*
  todo: implement our own controls?
  todo: more events: https://developer.mozilla.org/en-US/docs/DOM/Media_events
  todo: more methods/properties: https://developer.mozilla.org/en-US/docs/DOM/HTMLMediaElement
  todo: seekable, played
  http://html5doctor.com/html5-audio-the-state-of-play/
  */

  var

  CURRENT_TIME_MONITOR_MS = 16,
  EMPTY_STRING = "",

  formats = {
    'png': 'png',
    'apng': 'png',
    'gif': 'gif',
    'jpg': 'jpeg',
    'jpeg': 'jpeg',
    'jpe': 'jpeg',
    'bmp': 'bmp',

    'webp': {
      support: 'maybe',
      mime: 'webp'
    },
    'svg': {
      support: 'maybe',
      mime: 'webp'
    }
  },
  dataUriRegex = /^data:([A-Za-z\-]+)\/([A-Za-z\-]+)(;|,)/,
  fileExtRegex = /\.([a-z]+)\/?$/i,
  queryStringRegex = /(?:^|&)([^&=]*)=?([^&]*)/g;

  ( function () {
    //detect svg support

    var img;

    //basic, borrowed from Modernizr, Thanks to Erik Dahlstrom
    if ( !document.createElementNS ||
     !document.createElementNS( "http://www.w3.org/2000/svg", "svg").createSVGRect ) {

      formats.svg.support = '';
      return;
    }

    img = document.createElement( "img" );
    img.setAttribute( "src", "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNzUiIGhlaWdodD0iMjc1Ij48L3N2Zz4%3D" );
    if ( img.naturalWidth || img.width ) {
      formats.svg.support = 'probably';
      return;
    }

    img.addEventListener( "load", function () {
      formats.svg.support = 'probably';
    }, true );

    img.addEventListener( "error", function () {
      formats.svg.support = "";
    }, true );

  }() );

  ( function () {
    //detect webp support

    var basic, lossless;

    //a little help from http://stackoverflow.com/questions/5573096/detecting-webp-support
    basic = document.createElement( "img" );
    basic.setAttribute( "src", "data:image/webp;base64,UklGRjIAAABXRUJQVlA4ICYAAACyAgCdASoCAAEALmk0mk0iIiIiIgBoSygABc6zbAAA/v56QAAAAA==" );
    if ( !basic.naturalWidth && !basic.width ) {
      basic.addEventListener( "error", function () {
        formats.webp.support = "";
      }, true );
    }

    lossless = document.createElement( "img" );
    lossless.setAttribute( "src", "data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAQAAAAfQ//73v/+BiOh/AAA=" );
    if ( lossless.naturalWidth || lossless.width ) {
      formats.webp.support = "probably";
      return;
    }

    lossless.addEventListener( "load", function () {
      formats.webp.support = "probably";
    }, true );

  }() );

  function HTMLImageVideoElement( id ) {

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
        width: null,
        height: null,
        error: null,
        cover: false,
        played: false
      },
      startTime = 0,
      lastTimeUpdate = 0,
      currentTimeInterval,
      lastCurrentTime,

      timeRanges;

    function monitorCurrentTime() {
      var currentTime, ended = false;

      if ( impl.paused ) {
        return;
      }

      currentTime = ( Date.now() - startTime ) / 1000;

      if ( impl.currentTime === currentTime ) {
        return;
      }

      impl.currentTime = currentTime;

      if ( currentTime >= impl.duration ) {
        ended = true;
      }

      //todo: throttle
      self.dispatchEvent( "timeupdate" );

      lastCurrentTime = impl.currentTime;

      if ( ended ) {
        impl.ended = true;
        self.dispatchEvent( "ended" );
        if (impl.loop) {
          changeCurrentTime( 0 );
          if ( !self.paused ) {
            self.play();
          }
        }
      }
    }

    function changeCurrentTime( time ) {
      var i, media;

      if ( ( !impl.duration && time ) || time < 0 || time > impl.duration || isNaN(time) ) {
        throw 'Invalid time';
      }

      impl.currentTime = time;
      startTime = Date.now() - impl.currentTime * 1000;
      monitorCurrentTime();

    }

    function destroyPlayer() {
      if ( elem ) {
        elem.src = "";
      }

      //todo: set networkstate, readystate
      impl.played = false;
      impl.currentTime = 0;
      impl.seeking = false;
      impl.duration = NaN;
      impl.ended = false;
      impl.paused = true;
      impl.error = null;

    }

    function onLoadedMetadata() {
      if ( !impl.duration || impl.duration < 0 ) {
        impl.duration = 1; //todo: set duration from parameters
      }

      impl.videoWidth = elem.naturalWidth;
      impl.videoHeight = elem.naturalHeight;

      impl.networkState = self.NETWORK_IDLE;
      impl.readyState = self.HAVE_METADATA;

      changeCurrentTime( impl.currentTime );

      self.dispatchEvent( "loadedmetadata" );
      self.dispatchEvent( "durationchange" );

      self.dispatchEvent( "progress" );
      self.dispatchEvent( "loadeddata" );

      impl.readyState = self.HAVE_FUTURE_DATA;
      self.dispatchEvent( "canplay" );

      impl.readyState = self.HAVE_ENOUGH_DATA;
      self.dispatchEvent( "canplaythrough" );

      // Auto-start if necessary
      if( impl.autoplay ) {
        self.play();
      }
    }

    function onError( evt ) {
      var err = { name: "MediaError" };
      impl.error = err;
      self.dispatchEvent( "error" );
    }

    function changeSrc( src ) {
      var url;

      function extractDuration( all, key, value ) {
        if ( key === "duration" ) {
          impl.duration = parseFloat( value );
        }
      }

      if( !self._canPlaySrc( src ) ) {
        impl.error = {
          name: "MediaError",
          message: "Media Source Not Supported",
          code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        };
        self.dispatchEvent( "error" );
        return;
      }

      destroyPlayer();

      //parse out source for duration
      url = src.split( "#" );
      if ( url[ 1 ] ) {
        url[ 1 ].replace( queryStringRegex, extractDuration );
      }
      src = url[ 0 ];

      if ( !impl.duration || impl.duration < 0 ) {
        impl.duration = url.queryKey && parseFloat( url.queryKey.duration );
      }

      if ( !elem ) {
        elem = document.createElement( "img" );
        parent.appendChild( elem );
        elem.addEventListener( "load", onLoadedMetadata, true);
        elem.addEventListener( "error", onError, true);
      }

      if ( !isNaN( impl.width ) ) {
        elem.width = impl.width;
      }

      if ( !isNaN( impl.height ) ) {
        elem.height = impl.height;
      }

      elem.src = src;
    }

    // Namespace all events we'll produce
    self._eventNamespace = Popcorn.guid( "HTMLImageVideoElement::" );

    self.parentNode = parent;

    //so the original doesn't get modified
    self._util = Popcorn.extend( {}, self._util );

    self._util.type = "Image";

    self.play = function() {
      if ( !impl.paused ) {
        return;
      }

      impl.paused = false;

      changeCurrentTime( impl.currentTime );

      if ( !currentTimeInterval ) {
        setInterval( monitorCurrentTime, CURRENT_TIME_MONITOR_MS );
      }
      self.dispatchEvent( "play" );
    };

    self.pause = function() {
      if ( impl.paused ) {
        return;
      }

      impl.paused = true;

      if ( !currentTimeInterval ) {
        clearInterval( currentTimeInterval );
        currentTimeInterval = false;
      }
      self.dispatchEvent( "pause" );
    };

    timeRanges = {
      start: function( index ) {
        if ( index !== 0 ) {
          //throw fake DOMException/INDEX_SIZE_ERR
          throw "INDEX_SIZE_ERR: DOM Exception 1";
        }

        return 0;
      },

      end: function( index ) {
        if ( index !== 0 ) {
          //throw fake DOMException/INDEX_SIZE_ERR
          throw "INDEX_SIZE_ERR: DOM Exception 1";
        }

        return impl.duration || 0;
      }
    };
    Object.defineProperties( timeRanges, {
      length: {
        get: function() {
          return 1;
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
          return elem.width;
        },
        set: function( aValue ) {
          if ( elem ) {
            elem.setAttribute('width', aValue);
            impl.width = elem.width;
          } else {
            impl.width = aValue;
          }
        }
      },

      height: {
        get: function() {
          return elem.height;
        },
        set: function( aValue ) {
          if ( elem ) {
            elem.setAttribute('height', aValue);
            impl.height = elem.height;
          } else {
            impl.height = aValue;
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
          return impl.videoHeight;
        }
      },

      currentTime: {
        get: function() {
          return impl.currentTime;
        },
        set: function( aValue ) {
          changeCurrentTime( aValue );
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
          aValue = parseFloat( aValue );
          if( aValue < 0 || aValue > 1 || isNaN( aValue ) ) {
            throw "Volume value must be between 0.0 and 1.0";
          }

          if ( impl.volume === aValue ) {
            return;
          }

          impl.volume = aValue;
          self.dispatchEvent( "volumechange" );
        }
      },

      muted: {
        get: function() {
          return impl.muted;
        },
        set: function( aValue ) {
          impl.muted = !!self._util.isAttributeSet( aValue );
          self.dispatchEvent( "volumechange" );
        }
      },

      buffered: {
        get: function () {
          return timeRanges;
        }
      },

      error: {
        get: function() {
          return impl.error;
        }
      }
    });
  }

  HTMLImageVideoElement.prototype = new Popcorn._MediaElementProto();
  HTMLImageVideoElement.prototype.constructor = HTMLImageVideoElement;

  // Helper for identifying URLs we know how to play.
  HTMLImageVideoElement.prototype._canPlaySrc = function( url ) {
    var result, ext, mime;

    //first, see if this is a dataURI
    if ( !url || typeof url !== "string" ) {
      return EMPTY_STRING;
    }

    result = dataUriRegex.exec( url );
    if ( result ) {
      if ( result[ 1 ].toLowerCase() !== 'image' ) {
        return EMPTY_STRING;
      }

      return HTMLImageVideoElement.prototype.canPlayType( ( result[ 1 ] + "/" + result[ 2 ] ).toLowerCase() );
    }

    //get extension
    result = Popcorn._MediaElementProto.prototype._util.parseUri( url );
    if ( !result ) {
      return;
    }
    ext = fileExtRegex.exec(result.file) || fileExtRegex.exec(result.file);
    if ( ext ) {
      ext = ext[ 1 ];
      mime = "image/" + ext.toLowerCase();
    } else {
      return EMPTY_STRING;
      //todo: parse format from result.anchor?
    }

    return HTMLImageVideoElement.prototype.canPlayType( mime );
  };

  // We'll attempt to support a mime type of video/x-vimeo
  HTMLImageVideoElement.prototype.canPlayType = function( type ) {
    if ( !type || typeof type !== 'string' ) {
      return EMPTY_STRING;
    }

    type = type.toLowerCase();
    type = type.split( "/" );
    if ( type[0] !== "image" ) {
      return EMPTY_STRING;
    }

    type = formats[ type[ 1 ] ];

    if ( !type ) {
      return EMPTY_STRING;
    }

    if ( typeof type === 'string' ) {
      return "probably";
    }

    return type.support || EMPTY_STRING;
  };

  Popcorn.HTMLImageVideoElement = function( id ) {
    return new HTMLImageVideoElement( id );
  };
  Popcorn.HTMLImageVideoElement._canPlaySrc = HTMLImageVideoElement.prototype._canPlaySrc;

}( Popcorn, window, document ));
