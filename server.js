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

const PORT =
    Number(process.env.PORT) || 10000;

const HOST =
    "0.0.0.0";

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
 PLAYBACK STATE
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

    albumArt:
        null,

    duration:
        0,

    spotifyPosition:
        0,

    syncedAt:
        0,

    isPlaying:
        false,

    spotifyUrl:
        "",

    lastSpotifyCheck:
        0,

    transition:
        "STOPPED",

    transitionUntil:
        0,

    spotifyRequests:
        0,

    spotifyErrors:
        0,

    lastSpotifyStatus:
        null,

    lastSpotifyError:
        null

};


/*
==================================================
 SPOTIFY POLLING
==================================================
*/

const SPOTIFY_POLL_PLAYING =
    15000;

const SPOTIFY_POLL_PAUSED =
    20000;

const SPOTIFY_POLL_TRANSITION =
    5000;

const SPOTIFY_POLL_ERROR =
    15000;

const SPOTIFY_POLL_INITIAL =
    1000;


/*
==================================================
 SEEK DETECTION
==================================================
*/

const SEEK_THRESHOLD =
    2500;

const TRANSITION_DURATION =
    1800;


let spotifyPollTimer =
    null;

let spotifyRequestRunning =
    false;

let spotifyRetryAfter =
    0;


/*
==================================================
 LOAD TOKEN
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
 SAVE TOKEN
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
 FRONTEND
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
                .randomBytes(32)
                .toString("hex");


        const scope =
            [
                "user-read-currently-playing",
                "user-read-playback-state"
            ].join(" ");


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
                    .toString("base64");


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
 REFRESH ACCESS TOKEN
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
            .toString("base64");


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
 GET VALID TOKEN
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
*/

function getLocalPosition() {

    if (
        !playbackState.isPlaying
    ) {

        return playbackState.spotifyPosition;
    }


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


    if (
        playbackState.duration > 0 &&
        position > playbackState.duration
    ) {

        return playbackState.duration;
    }


    return position;
}


/*
==================================================
 UI TRANSITION
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
==================================================
*/

async function fetchSpotifyPlayback() {

    if (
        spotifyRequestRunning
    ) {

        return null;
    }


    if (
        Date.now() <
        spotifyRetryAfter
    ) {

        return null;
    }


    spotifyRequestRunning =
        true;


    try {

        const token =
            await getAccessToken();


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
                `⚠ Spotify rate limited. Waiting ${retryAfter}s`
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


            return null;
        }


        /*
        ==========================================
        OTHER ERRORS
        ==========================================
        */

        if (
            response.status !== 200 &&
            response.status !== 204
        ) {

            playbackState.spotifyErrors++;

            playbackState.lastSpotifyError =
                `Spotify returned HTTP ${response.status}`;


            return null;
        }


        /*
        ==========================================
        NOTHING PLAYING
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

                /*
                ==================================
                ALBUM ART
                ==================================

                Spotify normally returns the largest
                artwork first.

                This is sent directly to the frontend.
                */

                albumArt:
                    item.album?.images?.[0]?.url ||
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


        playbackState.lastSpotifyStatus =
            error.response?.status ||
            null;


        playbackState.lastSpotifyError =
            error.response?.data ||
            error.message;


        console.error(
            "Spotify polling error:",
            error.response?.data ||
            error.message
        );


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
    STOPPED
    ==========================================
    */

    if (
        !playback ||
        !playback.track
    ) {

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
            `♪ Track changed: ${track.title} - ${track.artist}`
        );


        playbackState.trackId =
            track.id;

        playbackState.title =
            track.title;

        playbackState.artist =
            track.artist;

        playbackState.album =
            track.album;

        playbackState.albumArt =
            track.albumArt;

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
            playback.playing
                ? "TRACK_CHANGED"
                : "PAUSED"
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
            "⏸ Spotify paused"
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
            "RESUMED";


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
        spotifyPosition -
        localPosition;


    if (
        Math.abs(difference) >
        SEEK_THRESHOLD
    ) {

        const seekType =
            difference > 0
                ? "FAST_FORWARD"
                : "REWIND";


        console.log(
            seekType === "FAST_FORWARD"
                ? "⏩ Fast-forward detected"
                : "⏪ Rewind detected"
        );


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


        setTransition(
            seekType
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

    const previousTrack =
        playbackState.trackId;


    const previousPlaying =
        playbackState.isPlaying;


    const playback =
        await fetchSpotifyPlayback();


    if (!playback) {

        scheduleSpotifyPoll(
            SPOTIFY_POLL_ERROR
        );

        return;
    }


    processSpotifyPlayback(
        playback
    );


    const changed =
        previousTrack !==
            playbackState.trackId ||
        previousPlaying !==
            playbackState.isPlaying;


    if (
        changed
    ) {

        scheduleSpotifyPoll(
            SPOTIFY_POLL_TRANSITION
        );

        return;
    }


    if (
        playbackState.transition &&
        Date.now() <
        playbackState.transitionUntil
    ) {

        scheduleSpotifyPoll(
            SPOTIFY_POLL_TRANSITION
        );

        return;
    }


    if (
        playbackState.isPlaying
    ) {

        scheduleSpotifyPoll(
            SPOTIFY_POLL_PLAYING
        );

        return;
    }


    scheduleSpotifyPoll(
        SPOTIFY_POLL_PAUSED
    );
}


/*
==================================================
 CURRENT PLAYBACK API
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

            /*
            Album artwork is now exposed
            to the frontend.
            */

            albumArt:
                playbackState.albumArt,

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
 LRCLIB CACHE
==================================================
*/

const lyricsCache =
    new Map();


const LYRICS_CACHE_TTL =
    24 * 60 * 60 * 1000;


const LYRICS_NOT_FOUND_TTL =
    6 * 60 * 60 * 1000;


function createLyricsCacheKey(
    trackId,
    title,
    artist,
    album,
    duration
) {

    if (trackId) {

        return `spotify:${trackId}`;
    }


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


function getCachedLyrics(
    cacheKey
) {

    const cached =
        lyricsCache.get(
            cacheKey
        );


    if (!cached) {

        return null;
    }


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
 LRCLIB
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


        const cacheKey =
            createLyricsCacheKey(
                trackId,
                title,
                artist,
                album,
                duration
            );


        const cached =
            getCachedLyrics(
                cacheKey
            );


        if (cached) {

            console.log(
                `✓ Lyrics cache hit: ${artist} - ${title}`
            );


            return res.json({

                ...cached.data,

                cached:
                    true

            });
        }


        console.log(
            `○ Lyrics cache miss: ${artist} - ${title}`
        );


        try {

            const durationSeconds =
                duration > 0
                    ? Math.round(
                        duration / 1000
                    )
                    : undefined;


            const params = {

                track_name:
                    title,

                artist_name:
                    artist

            };


            if (album) {

                params.album_name =
                    album;
            }


            if (
                durationSeconds &&
                durationSeconds >= 1 &&
                durationSeconds <= 3600
            ) {

                params.duration =
                    durationSeconds;
            }


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

                    id:
                        trackId,

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


            saveLyricsCache(
                cacheKey,
                result,
                true
            );


            console.log(
                `✓ Lyrics cached: ${artist} - ${title}`
            );


            return res.json({

                ...result,

                cached:
                    false

            });


        } catch (error) {

            if (
                error.response?.status === 404
            ) {

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


            if (
                error.response?.status === 429
            ) {

                return res
                    .status(429)
                    .json({

                        available:
                            false,

                        lyrics:
                            null,

                        syncedLyrics:
                            null,

                        error:
                            "Lyrics service rate limited."

                    });
            }


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
            `Status:  http://${HOST}:${PORT}/api/current`
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


        scheduleSpotifyPoll(
            SPOTIFY_POLL_INITIAL
        );

        console.log("");
    }
);