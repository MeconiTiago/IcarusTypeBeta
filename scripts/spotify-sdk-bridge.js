(function () {
  if (window.__spotifySdkBridgeInstalled) return;
  window.__spotifySdkBridgeInstalled = true;

  var previous = window.onSpotifyWebPlaybackSDKReady;
  window.__spotifySdkLoaded = false;

  window.onSpotifyWebPlaybackSDKReady = function () {
    window.__spotifySdkLoaded = true;
    try {
      window.dispatchEvent(new Event('spotify-web-playback-sdk-ready'));
    } catch (_err) {}
    if (typeof previous === 'function') {
      try { previous(); } catch (_err) {}
    }
  };
})();

