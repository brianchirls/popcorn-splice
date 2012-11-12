(function( window, undefined ) {

	"use strict";

	function Touch(element, down, move, up) {
		var started = 0;

		function mouseMove(e) {
			var x, y;
			if (!isNaN(e.pageX)) {
				x = e.pageX;
				y = e.pageY;
			} else {
				x = e.clientX + document.body.scrollLeft + document.documentElement.scrollLeft;
				y = e.clientY + document.body.scrollTop + document.documentElement.scrollTop;
			}

			move(e || window.event, x, y);
		}

		function mouseUp(e) {
			started = 0;

			if (up) {
				up(e || window.event);
			}
			document.removeEventListener('mousemove', mouseMove, false);
			document.removeEventListener('mouseup', mouseUp, false);
		}

		function mouseDown(e) {
			var go = true,
				x, y;

			started = 1;

			if (down) {
				if (!e) {
					e = window.event;
				}
				if (!isNaN(e.pageX)) {
					x = e.pageX;
					y = e.pageY;
				} else {
					x = e.clientX + document.body.scrollLeft + document.documentElement.scrollLeft;
					y = e.clientY + document.body.scrollTop + document.documentElement.scrollTop;
				}
				go = down(e || window.event, x, y);
				if ((go || go === undefined) && e.preventDefault) {
					e.preventDefault();
				} else {
					return;
				}
			}
			if (move) {
				document.addEventListener('mousemove', mouseMove, false);
			}
			document.addEventListener('mouseup', mouseUp, false);
		}

		function touchMove(e) {
			var touch = (e.changedtouches && e.changedtouches.length && e.changedtouches[0]) ||
				(e.touches && e.touches.length && e.touches[0]) || e || window.event;

			move(touch, touch.pageX, touch.pageY);
			return false;
		}

		function touchEnd(e) {
			started = 0;

			if (up) {
				up(e.changedtouches[0]);
			}
			document.removeEventListener('touchmove', touchMove, false);
			document.removeEventListener('touchend', touchEnd, false);
		}

		function touchStart(e) {
			var go, touch;
			started = 2;

			if (e.preventDefault) { e.preventDefault(); }
			element.removeEventListener('mousedown', mouseDown, false);

			if (down) {
				touch = e.touches[0];
				go = down(touch || window.event, touch.pageX, touch.pageY);
				if ((go || go === undefined) && e.preventDefault) {
					e.preventDefault();
				} else {
					return;
				}
			}

			if (move) {
				document.addEventListener('touchmove', touchMove, false);
			}
			document.addEventListener('touchend', touchEnd, false);
		}

		element.addEventListener('mousedown', mouseDown, false);
		element.addEventListener('touchstart', touchStart, false);

		this.remove = function () {
			element.removeEventListener('mousedown', mouseDown, false);
			element.removeEventListener('touchstart', touchStart, false);

			if (started > 1) {
				touchEnd();
			} else if (started) {
				mouseUp();
			}
		};

		this.target = function() {
			return element;
		};
	}

	window.Touch = Touch;
}( window ));
