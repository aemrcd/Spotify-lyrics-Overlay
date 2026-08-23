require("dotenv").config();

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();


/*
==================================================
 SERVER CONFIG
==================================================
*/

const PORT = Number(process.env.PORT) || 10000;
const HOST = "0.0.0.0";

const REDIRECT_URI =
    process.env.SPOTIFY_REDIRECT_URI ||
    `http://127.0.0.1:${PORT}/callback`;

/*
==================================================
 SPOTIFY CONFIG
==================================================
*/

const CLIENT_ID =
    process.env.SPOTIFY_CLIENT_ID;

const CLIENT_SECRET =
    process.env.SPOTIFY_CLIENT_SECRET;


if (!CLIENT_ID || !CLIENT_SECRET) {

    console.error(
        "❌ Spotify credentials are missing from .env"
    );

    process.exit(1);

}


/*
==================================================
 FILES
==================================================
*/

const TOKEN_FILE =
    path.join(
        __dirname,
        "spotify-token.json"
    );


/*
==================================================
 AUTH STATE
==================================================
*/

let spotifyToken = null;
let loginState = null;


/*
==================================================
 SPOTIFY PLAYBACK STATE
==================================================

This object is our local source of truth.

The browser can read this state without
contacting Spotify.

==================================================
*/

const playbackState = {

    status:
        "STOPPED",

    trackId:
        null,

    title:
        null,

    artist:
        null,

    album:
        null,

    duration:
        0,

    /*
    Position received from Spotify.
    */

    spotifyPosition:
        0,

    /*
    Time when spotifyPosition was received.
    */

    syncedAt:
        0,

    /*
    Current playback state.
    */

    isPlaying:
        false,

    spotifyUrl:
        "",

    /*
    Last successful Spotify synchronization.
    */

    lastSpotifyCheck:
        0,

    /*
    Transition for frontend.
    */

    transition:
        null,

    transitionUntil:
        0,

    /*
    Number of successful Spotify checks.
    */

    spotifyRequests:
        0,

    /*
    Number of Spotify errors.
    */

    spotifyErrors:
        0,

    /*
    Last HTTP status.
    */

    lastSpotifyStatus:
        null,

    /*
    Last error message.
    */

    lastSpotifyError:
        null

};


/*
==================================================
 SPOTIFY POLLING CONFIG
==================================================
*/

/*
Playing:

15 seconds between Spotify checks.

The local clock handles the seconds between
Spotify requests.
*/

const SPOTIFY_POLL_PLAYING =
    15000;


/*
Paused:

20 seconds because position is not moving.
*/

const SPOTIFY_POLL_PAUSED =
    20000;


/*
When something changes:

Check again after 5 seconds.
*/

const SPOTIFY_POLL_TRANSITION =
    5000;


/*
After an error:

Don't hammer Spotify.
*/

const SPOTIFY_POLL_ERROR =
    15000;


/*
Initial check.
*/

const SPOTIFY_POLL_INITIAL =
    1000;


/*
Seek detection tolerance.

2500ms = 2.5 seconds.

Small differences are normal because the
local clock and Spotify timestamps won't
always be identical.
*/

const SEEK_THRESHOLD =
    2500;


/*
Transition display duration.
*/

const TRANSITION_DURATION =
    2000;


let spotifyPollTimer =
    null;

let spotifyRequestRunning =
    false;

let spotifyRetryAfter =
    0;


/*
==================================================
 LOAD SPOTIFY TOKEN
==================================================
*/

function loadToken() {

    if (
        !fs.existsSync(
            TOKEN_FILE
        )
    ) {

        return;

    }


    try {

        spotifyToken =
            JSON.parse(
                fs.readFileSync(
                    TOKEN_FILE,
                    "utf8"
                )
            );


        console.log(
            "Saved Spotify token loaded."
        );

    } catch (error) {

        console.error(
            "Could not load Spotify token:",
            error.message
        );


        spotifyToken =
            null;

    }

}


loadToken();


/*
==================================================
 SAVE SPOTIFY TOKEN
==================================================
*/

function saveToken(
    token
) {

    spotifyToken =
        token;


    fs.writeFileSync(

        TOKEN_FILE,

        JSON.stringify(
            token,
            null,
            2
        )

    );

}


/*
==================================================
 SERVE FRONTEND
==================================================
*/

app.use(
    express.static(
        __dirname
    )
);


/*
==================================================
 SPOTIFY LOGIN
==================================================
*/

app.get(
    "/login",
    (req, res) => {

        loginState =
            crypto
                .randomBytes(
                    32
                )
                .toString(
                    "hex"
                );


        const scope =
            [
                "user-read-currently-playing",
                "user-read-playback-state"
            ].join(
                " "
            );


        const params =
            new URLSearchParams({

                client_id:
                    CLIENT_ID,

                response_type:
                    "code",

                redirect_uri:
                    REDIRECT_URI,

                scope:
                    scope,

                state:
                    loginState

            });


        const spotifyURL =
            "https://accounts.spotify.com/authorize?" +
            params.toString();


        res.redirect(
            spotifyURL
        );

    }
);


/*
==================================================
 SPOTIFY CALLBACK
==================================================
*/

app.get(
    "/callback",
    async (req, res) => {

        try {

            const {
                code,
                state
            } = req.query;


            if (!code) {

                return res
                    .status(400)
                    .send(
                        "Spotify did not return an authorization code."
                    );

            }


            if (
                !state ||
                state !== loginState
            ) {

                return res
                    .status(400)
                    .send(
                        "Invalid Spotify login state."
                    );

            }


            const basicAuth =
                Buffer
                    .from(
                        `${CLIENT_ID}:${CLIENT_SECRET}`
                    )
                    .toString(
                        "base64"
                    );


            const response =
                await axios.post(

                    "https://accounts.spotify.com/api/token",

                    new URLSearchParams({

                        grant_type:
                            "authorization_code",

                        code:
                            code,

                        redirect_uri:
                            REDIRECT_URI

                    }).toString(),

                    {

                        headers: {

                            Authorization:
                                `Basic ${basicAuth}`,

                            "Content-Type":
                                "application/x-www-form-urlencoded"

                        }

                    }

                );


            const token =
                response.data;


            saveToken({

                access_token:
                    token.access_token,

                refresh_token:
                    token.refresh_token,

                expires_at:
                    Date.now() +
                    token.expires_in * 1000

            });


            res.send(`

<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<title>Spotify Connected</title>

<style>

body {

    margin: 0;

    height: 100vh;

    display: flex;

    justify-content: center;

    align-items: center;

    background: #101010;

    color: white;

    font-family: Arial, sans-serif;

}

.box {

    text-align: center;

    padding: 40px;

}

h1 {

    color: #1ed760;

}

</style>

</head>

<body>

<div class="box">

<h1>✓ Spotify Connected</h1>

<p>You can close this window.</p>

<p>Your TikTok overlay can now detect Spotify.</p>

</div>

</body>

</html>

`);

        } catch (error) {

            console.error(
                "Spotify callback error:",
                error.response?.data ||
                error.message
            );


            res
                .status(500)
                .send(
                    "Spotify authentication failed. Check PowerShell."
                );

        }

    }
);


/*
==================================================
 REFRESH SPOTIFY ACCESS TOKEN
==================================================
*/

async function refreshAccessToken() {

    if (
        !spotifyToken ||
        !spotifyToken.refresh_token
    ) {

        throw new Error(
            "Spotify login required."
        );

    }


    const basicAuth =
        Buffer
            .from(
                `${CLIENT_ID}:${CLIENT_SECRET}`
            )
            .toString(
                "base64"
            );


    const response =
        await axios.post(

            "https://accounts.spotify.com/api/token",

            new URLSearchParams({

                grant_type:
                    "refresh_token",

                refresh_token:
                    spotifyToken.refresh_token

            }).toString(),

            {

                headers: {

                    Authorization:
                        `Basic ${basicAuth}`,

                    "Content-Type":
                        "application/x-www-form-urlencoded"

                }

            }

        );


    const newToken =
        response.data;


    saveToken({

        access_token:
            newToken.access_token,

        refresh_token:
            newToken.refresh_token ||
            spotifyToken.refresh_token,

        expires_at:
            Date.now() +
            newToken.expires_in * 1000

    });


    console.log(
        "✓ Spotify access token refreshed."
    );


    return spotifyToken.access_token;

}


/*
==================================================
 GET VALID SPOTIFY ACCESS TOKEN
==================================================
*/

async function getAccessToken() {

    if (!spotifyToken) {

        throw new Error(
            "Spotify login required."
        );

    }


    const expiresSoon =
        Date.now() >
        spotifyToken.expires_at - 60000;


    if (expiresSoon) {

        return await refreshAccessToken();

    }


    return spotifyToken.access_token;

}


/*
==================================================
 LOCAL PLAYBACK CLOCK
==================================================

Instead of asking Spotify every second:

Spotify:

01:00

Node remembers:

01:00

One second later:

01:01

Two seconds later:

01:02

This avoids unnecessary Spotify API requests.

==================================================
*/

function getLocalPosition() {

    /*
    Paused or stopped.

    Position stays frozen.
    */

    if (
        !playbackState.isPlaying
    ) {

        return playbackState.spotifyPosition;

    }


    /*
    We haven't synchronized yet.
    */

    if (
        !playbackState.syncedAt
    ) {

        return playbackState.spotifyPosition;

    }


    const elapsed =
        Date.now() -
        playbackState.syncedAt;


    const position =
        playbackState.spotifyPosition +
        elapsed;


    /*
    Don't exceed song duration.
    */

    if (
        playbackState.duration > 0 &&
        position >
            playbackState.duration
    ) {

        return playbackState.duration;

    }


    return position;

}


/*
==================================================
 PLAYBACK TRANSITIONS
==================================================
*/

function setTransition(
    type
) {

    playbackState.transition =
        type;


    playbackState.transitionUntil =
        Date.now() +
        TRANSITION_DURATION;

}


/*
==================================================
 FETCH SPOTIFY PLAYBACK
==================================================*/

async function fetchSpotifyPlayback() {

    /*
    ==============================================
    PREVENT OVERLAPPING REQUESTS
    ==============================================
    */

    if (spotifyRequestRunning) {
        return null;
    }


    /*
    ==============================================
    RESPECT SPOTIFY RETRY-AFTER
    ==============================================
    */

    if (Date.now() < spotifyRetryAfter) {
        return null;
    }


    spotifyRequestRunning = true;


    try {

        const token =
            await getAccessToken();


        /*
        ==========================================
        SPOTIFY REQUEST
        ==========================================

        IMPORTANT:

        This is the ONLY Spotify request
        configuration object.

        ==========================================
        */

        const response =
            await axios.get(

                "https://api.spotify.com/v1/me/player/currently-playing",

                {

                    headers: {

                        Authorization:
                            `Bearer ${token}`

                    },

                    params: {

                        additional_types:
                            "track"

                    },

                    timeout:
                        5000,

                    validateStatus:
                        () => true

                }

            );


        /*
        ==========================================
        UPDATE MONITOR STATISTICS
        ==========================================
        */

        playbackState.lastSpotifyCheck =
            Date.now();

        playbackState.lastSpotifyStatus =
            response.status;

        playbackState.spotifyRequests++;


        console.log(
            `Spotify polling: ${response.status}`
        );


        /*
        ==========================================
        RATE LIMITED
        ==========================================
        */

        if (
            response.status === 429
        ) {

            const retryAfter =
                Number(
                    response.headers["retry-after"]
                ) || 10;


            spotifyRetryAfter =
                Date.now() +
                retryAfter * 1000;


            console.log(
                `⚠ Spotify rate limited. ` +
                `Waiting ${retryAfter}s`
            );


            return null;

        }


        /*
        ==========================================
        UNAUTHORIZED
        ==========================================
        */

        if (
            response.status === 401
        ) {

            playbackState.spotifyErrors++;

            playbackState.lastSpotifyError =
                "Spotify access token expired or invalid.";


            console.error(
                "❌ Spotify access token expired or invalid."
            );


            return null;

        }


        /*
        ==========================================
        OTHER HTTP ERRORS
        ==========================================
        */

        if (
            response.status !== 200 &&
            response.status !== 204
        ) {

            playbackState.spotifyErrors++;

            playbackState.lastSpotifyError =
                `Spotify returned HTTP ${response.status}`;


            console.error(
                "Spotify API response:",
                response.status,
                response.data
            );


            return null;

        }


        /*
        ==========================================
        NOTHING CURRENTLY PLAYING
        ==========================================
        */

        if (
            response.status === 204 ||
            !response.data ||
            !response.data.item
        ) {

            return {

                playing:
                    false,

                track:
                    null

            };

        }


        const data =
            response.data;


        const item =
            data.item;


        /*
        ==========================================
        ONLY HANDLE TRACKS
        ==========================================
        */

        if (
            item.type !== "track"
        ) {

            return {

                playing:
                    false,

                track:
                    null

            };

        }


        /*
        ==========================================
        RETURN NORMALIZED PLAYBACK DATA
        ==========================================
        */

        return {

            playing:
                Boolean(
                    data.is_playing
                ),

            position:
                Number(
                    data.progress_ms
                ) || 0,

            timestamp:
                Number(
                    data.timestamp
                ) || Date.now(),

            track: {

                id:
                    item.id,

                title:
                    item.name,

                artist:
                    item.artists
                        .map(
                            artist =>
                                artist.name
                        )
                        .join(", "),

                album:
                    item.album?.name ||
                    "",

                duration:
                    Number(
                        item.duration_ms
                    ) || 0,

                spotifyUrl:
                    item.external_urls?.spotify ||
                    ""

            }

        };


    } catch (error) {

        playbackState.spotifyErrors++;


        const status =
            error.response?.status ||
            null;


        const spotifyError =
            error.response?.data ||
            null;


        playbackState.lastSpotifyStatus =
            status;


        playbackState.lastSpotifyError =
            spotifyError ||
            error.message;


        console.error("");

        console.error(
            "===================================="
        );

        console.error(
            "Spotify polling error"
        );

        console.error(
            "===================================="
        );

        console.error(
            "Status:",
            status
        );

        console.error(
            "Response:",
            spotifyError
        );

        console.error(
            "Message:",
            error.message
        );

        console.error(
            "===================================="
        );

        console.error("");


        return null;


    } finally {

        spotifyRequestRunning =
            false;

    }

}
/*
==================================================
 PROCESS SPOTIFY PLAYBACK
==================================================
*/

function processSpotifyPlayback(
    playback
) {

    /*
    ==========================================
    NOTHING PLAYING
    ==========================================
    */

    if (
        !playback ||
        !playback.track
    ) {

        /*
        Don't repeatedly announce STOPPED.
        */

        if (
            playbackState.status !==
            "STOPPED"
        ) {

            console.log(
                "■ Spotify playback stopped"
            );


            playbackState.status =
                "STOPPED";


            playbackState.isPlaying =
                false;


            playbackState.spotifyPosition =
                0;


            playbackState.syncedAt =
                Date.now();


            setTransition(
                "STOPPED"
            );

        }


        return;

    }


    const track =
        playback.track;


    /*
    ==========================================
    NEW SONG
    ==========================================
    */

    if (
        playbackState.trackId !==
        track.id
    ) {

        console.log(
            `♪ Track changed: ` +
            `${track.title} - ${track.artist}`
        );


        playbackState.trackId =
            track.id;


        playbackState.title =
            track.title;


        playbackState.artist =
            track.artist;


        playbackState.album =
            track.album;


        playbackState.duration =
            track.duration;


        playbackState.spotifyUrl =
            track.spotifyUrl;


        playbackState.spotifyPosition =
            playback.position;


        playbackState.syncedAt =
            Date.now();


        playbackState.isPlaying =
            playback.playing;


        playbackState.status =
            playback.playing
                ? "PLAYING"
                : "PAUSED";


        setTransition(
            "TRACK_CHANGED"
        );


        return;

    }


    /*
    ==========================================
    PAUSE
    ==========================================
    */

    if (
        playbackState.isPlaying &&
        !playback.playing
    ) {

        console.log(
            "❚❚ Spotify paused"
        );


        playbackState.spotifyPosition =
            playback.position;


        playbackState.syncedAt =
            Date.now();


        playbackState.isPlaying =
            false;


        playbackState.status =
            "PAUSED";


        setTransition(
            "PAUSED"
        );


        return;

    }


    /*
    ==========================================
    RESUME
    ==========================================
    */

    if (
        !playbackState.isPlaying &&
        playback.playing
    ) {

        console.log(
            "▶ Spotify resumed"
        );


        playbackState.spotifyPosition =
            playback.position;


        playbackState.syncedAt =
            Date.now();


        playbackState.isPlaying =
            true;


        playbackState.status =
            "PLAYING";


        setTransition(
            "RESUMED"
        );


        return;

    }


    /*
    ==========================================
    SEEK DETECTION
    ==========================================
    */

    const localPosition =
        getLocalPosition();


    const spotifyPosition =
        playback.position;


    const difference =
        Math.abs(
            spotifyPosition -
            localPosition
        );


    if (
        difference >
        SEEK_THRESHOLD
    ) {

        console.log(
            `↪ Spotify seek detected ` +
            `(difference: ${Math.round(
                difference
            )}ms)`
        );


        playbackState.spotifyPosition =
            spotifyPosition;


        playbackState.syncedAt =
            Date.now();


        setTransition(
            "SEEKED"
        );


        return;

    }


    /*
    ==========================================
    NORMAL RESYNC
    ==========================================
    */

    playbackState.spotifyPosition =
        spotifyPosition;


    playbackState.syncedAt =
        Date.now();


    playbackState.isPlaying =
        playback.playing;


    playbackState.status =
        playback.playing
            ? "PLAYING"
            : "PAUSED";

}


/*
==================================================
 SPOTIFY POLLING LOOP
==================================================
*/

function scheduleSpotifyPoll(
    delay
) {

    clearTimeout(
        spotifyPollTimer
    );


    spotifyPollTimer =
        setTimeout(
            pollSpotify,
            delay
        );

}


async function pollSpotify() {

    const playback =
        await fetchSpotifyPlayback();


    /*
    Request failed.

    Wait before trying again.
    */

    if (!playback) {

        scheduleSpotifyPoll(
            SPOTIFY_POLL_ERROR
        );

        return;

    }


    const previousTrack =
        playbackState.trackId;


    const previousPlaying =
        playbackState.isPlaying;


    processSpotifyPlayback(
        playback
    );


    /*
    ==========================================
    DETECT STATE CHANGE
    ==========================================
    */

    const changed =
        previousTrack !==
            playbackState.trackId ||
        previousPlaying !==
            playbackState.isPlaying;


    /*
    State changed.

    Temporarily poll faster.
    */

    if (
        changed
    ) {

        scheduleSpotifyPoll(
            SPOTIFY_POLL_TRANSITION
        );


        return;

    }


    /*
    ==========================================
    PLAYING
    ==========================================
    */

    if (
        playbackState.isPlaying
    ) {

        scheduleSpotifyPoll(
            SPOTIFY_POLL_PLAYING
        );


        return;

    }


    /*
    ==========================================
    PAUSED / STOPPED
    ==========================================
    */

    scheduleSpotifyPoll(
        SPOTIFY_POLL_PAUSED
    );

}


/*
==================================================
 CURRENT PLAYBACK API
==================================================

IMPORTANT:

This endpoint DOES NOT call Spotify.

The frontend can request this as often as
necessary without consuming Spotify API calls.

==================================================
*/

app.get(
    "/api/current",
    (req, res) => {

        const position =
            getLocalPosition();


        const transition =
            playbackState.transition &&
            Date.now() <
                playbackState.transitionUntil

                ? playbackState.transition

                : null;


        res.json({

            playing:
                playbackState.isPlaying,

            status:
                playbackState.status,

            id:
                playbackState.trackId,

            title:
                playbackState.title,

            artist:
                playbackState.artist,

            album:
                playbackState.album,

            position:
                Math.round(
                    position
                ),

            duration:
                playbackState.duration,

            spotifyUrl:
                playbackState.spotifyUrl,

            transition,

            lastSpotifyCheck:
                playbackState.lastSpotifyCheck

        });

    }
);


/*
==================================================
 LRCLIB LYRIC CACHE
==================================================

The cache prevents repeated requests to LRCLIB
for the same song.

CACHE FLOW:

Browser
   │
   ▼
/api/lyrics
   │
   ├── Cache HIT
   │      │
   │      └──► Return lyrics immediately
   │
   └── Cache MISS
          │
          ▼
        LRCLIB
          │
          ▼
        Save cache
          │
          ▼
        Return lyrics

==================================================
*/


const lyricsCache =
    new Map();


/*
==================================================
 LYRIC CACHE SETTINGS
==================================================
*/

/*
Lyrics don't normally change.

Keep successful results for 24 hours.
*/

const LYRICS_CACHE_TTL =
    24 * 60 * 60 * 1000;


/*
Remember missing lyrics too.

Otherwise the same song without lyrics could
cause repeated LRCLIB requests.
*/

const LYRICS_NOT_FOUND_TTL =
    6 * 60 * 60 * 1000;


/*
==================================================
 CREATE LYRIC CACHE KEY
==================================================
*/

function createLyricsCacheKey(
    trackId,
    title,
    artist,
    album,
    duration
) {

    /*
    Spotify track ID is the preferred key.

    If we have it, use it.

    This means:

    Same Spotify song
        =
    Same cache entry
    */

    if (trackId) {

        return `spotify:${trackId}`;

    }


    /*
    Fallback for requests that don't contain
    a Spotify track ID.
    */

    return [

        "fallback",

        title
            .trim()
            .toLowerCase(),

        artist
            .trim()
            .toLowerCase(),

        album
            .trim()
            .toLowerCase(),

        Math.round(
            Number(duration) || 0
        )

    ].join("|");

}

/*
==================================================
 GET CACHED LYRICS
==================================================
*/

function getCachedLyrics(
    cacheKey
) {

    const cached =
        lyricsCache.get(
            cacheKey
        );


    /*
    Nothing cached.
    */

    if (!cached) {

        return null;

    }


    /*
    Check expiration.
    */

    if (
        Date.now() >
        cached.expiresAt
    ) {

        lyricsCache.delete(
            cacheKey
        );

        return null;

    }


    return cached;

}


/*
==================================================
 SAVE LYRICS TO CACHE
==================================================
*/

function saveLyricsCache(
    cacheKey,
    data,
    found
) {

    lyricsCache.set(

        cacheKey,

        {

            data,

            found,

            createdAt:
                Date.now(),

            expiresAt:
                Date.now() +
                (
                    found
                        ? LYRICS_CACHE_TTL
                        : LYRICS_NOT_FOUND_TTL
                )

        }

    );

}


/*
==================================================
 LRCLIB LYRICS API
==================================================
*/

app.get(
    "/api/lyrics",
    async (req, res) => {

	const trackId =
    	    String(
        	req.query.id ||
        	""
    	    ).trim();	

        const title =
            String(
                req.query.title ||
                ""
            ).trim();

        const artist =
            String(
                req.query.artist ||
                ""
            ).trim();


        const album =
            String(
                req.query.album ||
                ""
            ).trim();


        const duration =
            Number(
                req.query.duration ||
                0
            );


        /*
        ==========================================
        VALIDATION
        ==========================================
        */

        if (
            !title ||
            !artist
        ) {

            return res
                .status(400)
                .json({

                    available:
                        false,

                    lyrics:
                        null,

                    syncedLyrics:
                        null,

                    error:
                        "Missing title or artist."

                });

        }


        /*
        ==========================================
        CREATE CACHE KEY
        ==========================================
        */

        const cacheKey =
            createLyricsCacheKey(
		trackId,
                title,
                artist,
                album,
                duration
            );


        /*
        ==========================================
        CHECK CACHE
        ==========================================
        */

        const cached =
            getCachedLyrics(
                cacheKey
            );


        if (cached) {

            console.log(
                `✓ Lyrics cache hit: ` +
                `${artist} - ${title}`
            );


            return res.json({

                ...cached.data,

                cached:
                    true

            });

        }


        /*
        ==========================================
        CACHE MISS
        ==========================================
        */

        console.log(
            `○ Lyrics cache miss: ` +
            `${artist} - ${title}`
        );


        try {

            /*
            ======================================
            CONVERT DURATION
            ======================================
            */

            const durationSeconds =
                duration > 0

                    ? Math.round(
                        duration / 1000
                    )

                    : undefined;


            /*
            ======================================
            LRCLIB PARAMETERS
            ======================================
            */

            const params = {

                track_name:
                    title,

                artist_name:
                    artist

            };


            /*
            Album improves matching.
            */

            if (
                album
            ) {

                params.album_name =
                    album;

            }


            /*
            Duration improves matching.
            */

            if (
                durationSeconds &&
                durationSeconds >= 1 &&
                durationSeconds <= 3600
            ) {

                params.duration =
                    durationSeconds;

            }


            console.log(
                "→ Requesting LRCLIB:",
                params
            );


            /*
            ======================================
            LRCLIB REQUEST
            ======================================
            */

            const response =
                await axios.get(

                    "https://lrclib.net/api/get",

                    {

                        params,

                        headers: {

                            "User-Agent":
                                "SpotifyLyricsOverlay/1.0"

                        },

                        timeout:
                            10000

                    }

                );


            const data =
                response.data;


            /*
            ======================================
            NO LYRICS
            ======================================
            */

            if (
                !data ||
                (
                    !data.plainLyrics &&
                    !data.syncedLyrics
                )
            ) {

                const result = {

                    available:
                        false,

                    title:
                        title,

                    artist:
                        artist,

                    album:
                        album,

                    lyrics:
                        null,

                    syncedLyrics:
                        null

                };


                /*
                Cache the negative result.

                This prevents repeatedly asking
                LRCLIB for the same missing song.
                */

                saveLyricsCache(

                    cacheKey,

                    result,

                    false

                );


                return res.json({

                    ...result,

                    cached:
                        false

                });

            }


            /*
            ======================================
            NORMAL LYRICS RESULT
            ======================================
            */

            const result = {

                available:
                    true,

		id:
        	    trackId,

                title:
                    data.trackName ||
                    title,

                artist:
                    data.artistName ||
                    artist,

                album:
                    data.albumName ||
                    album,

                lyrics:
                    data.plainLyrics ||
                    null,

                syncedLyrics:
                    data.syncedLyrics ||
                    null

            };


            /*
            ======================================
            SAVE SUCCESSFUL RESULT
            ======================================
            */

            saveLyricsCache(

                cacheKey,

                result,

                true

            );


            console.log(
                `✓ Lyrics cached: ` +
                `${artist} - ${title}`
            );


            return res.json({

                ...result,

                cached:
                    false

            });


        } catch (error) {

            /*
            ======================================
            NOT FOUND
            ======================================
            */

            if (
                error.response?.status === 404
            ) {

                console.log(
                    `Lyrics not found: ` +
                    `${artist} - ${title}`
                );


                const result = {

		    id:
		        trackId,

                    available:
                        false,

                    title:
                        title,

                    artist:
                        artist,

                    album:
                        album,

                    lyrics:
                        null,

                    syncedLyrics:
                        null,

                    message:
                        "Lyrics not found."

                };


                /*
                Cache the missing result.
                */

                saveLyricsCache(

                    cacheKey,

                    result,

                    false

                );


                return res.json({

                    ...result,

                    cached:
                        false

                });

            }


            /*
            ======================================
            LRCLIB RATE LIMIT
            ======================================
            */

            if (
                error.response?.status === 429
            ) {

                console.log(
                    "⚠ LRCLIB rate limit reached."
                );


                return res
                    .status(429)
                    .json({

                        available:
                            false,

                        title:
                            title,

                        artist:
                            artist,

                        lyrics:
                            null,

                        syncedLyrics:
                            null,

                        error:
                            "Lyrics service rate limited."

                    });

            }


            /*
            ======================================
            OTHER ERROR
            ======================================
            */

            console.error(
                "LRCLIB error:",
                error.response?.status,
                error.response?.data ||
                error.message
            );


            return res
                .status(502)
                .json({

                    available:
                        false,

                    title:
                        title,

                    artist:
                        artist,

                    lyrics:
                        null,

                    syncedLyrics:
                        null,

                    error:
                        "Unable to contact lyrics service."

                });

        }

    }
);

/*
==================================================
 START SERVER
==================================================
*/

app.listen(
    PORT,
    HOST,
    () => {

        console.log("");

        console.log(
            "===================================="
        );

        console.log(
            " Spotify TikTok Lyrics Overlay"
        );

        console.log(
            "===================================="
        );

        console.log("");

        console.log(
            `Overlay: http://${HOST}:${PORT}`
        );

        console.log(
            `Login:   http://${HOST}:${PORT}/login`
        );

        console.log(
            `Status:  http://${HOST}:${PORT}/api/status`
        );

        console.log("");

        if (
            spotifyToken
        ) {

            console.log(
                "✓ Spotify token loaded"
            );

        } else {

            console.log(
                "⚠ Spotify not connected"
            );

            console.log(
                `Open http://${HOST}:${PORT}/login`
            );

        }


        console.log(
            "✓ Starting Spotify playback monitor..."
        );


        /*
        Start Spotify synchronization
        one second after the server starts.
        */

        scheduleSpotifyPoll(
            SPOTIFY_POLL_INITIAL
        );


        console.log("");

    }
);