'use_strict';
const Easing = require('./easing.js');
const EventEmitter = require('events').EventEmitter
const Tracks = require('./tracks');

/**
 * Timeline to manage javascript elements and their properties per keyframe.
 * 
 * extends EventEmitter
 */
class Timeline extends EventEmitter {
    constructor() {
        super();
        this.name = "Global";
        this.tracks = [];
        this.targets = [];
        this.time = 0;
        this.totalTime = 0;
        this.loopCount = 0;
        this.loopMode = -1;
        this.playing = true;

        // Rotate the sound field by passing Three.js camera object. (4x4 matrix)
        // this.audio.renderer.setRotationMatrixFromCamera(this.camera.matrix);
        // this.audio.on('audio:ready', () => {
        //     document.getElementById('audioStatus').textContent = 'audio:ready';
        // })
    }
    /**
     * Possible values of n:
     *  
     * -1 infinite loop
     *  0  play forever without looping, continue increasing time even after last animation
     *  1  play once and stop at the time the last animation finishes
     * >1 loop n-times
     * 
     * @param {Number} n 
     */
    loop(n) {
        this.loopMode = n;
    }
    /**
     * Stop 
     */
    stop() {
        this.playing = false;
        this.time = 0;
        this.restartTracks();
        // this.audio.audioElement.pause();
        // this.audio.audioElement.currentTime = 0;
    }
    /**
     * Pause
     */
    pause() {
        this.playing = false;
        // this.audio.audioElement.pause();
    }
    /**
     * Play
     */
    play() {
        if(this.time > this.endTime) {
            this.time = 0;
            this.restartTracks();
        }
        
        this.playing = true;
        // this.audio.audioElement.play();
    }
    /**
     * 
     * @param {Number} deltaTime 
     */
    update(deltaTime) {
        //Let the GUI know the Timeline changed.
        this.emit('update');

        if (this.playing) {
            this.totalTime += deltaTime;
            this.time += deltaTime;
        }

        //Update the keyframe nodes when the timeline loops back.
        if (this.loopMode !== 0) {
            let animationEnd = this.findAnimationEnd();

            if (this.time > animationEnd) {
                this.loopCount += 1;
                
                if (this.loopMode == -1 || (this.loopCount <= this.loopMode)) {
                    this.time = 0;
                    this.restartTracks();
                }
                else {
                    this.playing = false;
                }
            }
        }

        this.applyValues();
    }
    /**
     * Iterate all of the tracks and check their end time. 
     * The end time has delay, duration properties.
     */
    findAnimationEnd() {
        let endTime = 0;

        for (let i = 0; i < this.tracks.length; i++) {
            if (this.tracks[i].endTime > endTime) {
                endTime = this.tracks[i].endTime;
            }
        }

        this.endTime = endTime;

        return endTime;
    }
    /**
     * Export timeline values.
     */
    getJson() {
        let timelineJson = '';

        timelineJson = JSON.stringify(this.tracks, function (key, value) {
            if (key === 'timeline' ||
                key === 'parent' ||
                key === '_events'
            ) {
                return undefined;
            }
            else {
                return value;
            }
        }, '\t');

        return timelineJson;
    }
    restartTracks() {
        this.tracks.forEach((track, index, tracksReturn) => {
            //Iterate keysmap keys
            if (track.keysMap) {
                for (let property in track.keysMap) {
                    track.keysMap[property].keys.forEach((key, index, keysReturn) => {
                        keysReturn[index].hasStarted = false;
                        keysReturn[index].hasEnded = false;
                    })

                    if (track.keysMap[property].following) {
                        track.keysMap[property].followKeys.forEach((key, index, keysReturn) => {
                            keysReturn[index].hasStarted = false;
                            keysReturn[index].hasEnded = false;
                        })
                    }
                }
            }
            else if (track.recording) {
                tracksReturn[index].nextTick = 0;
            }
        });
    }
    /**
     * Parse the incoming JSON stream and re-init objects for use
     * in the timeline data structure.
     */
    resetTracks(tracksCode, userScene) {
        try {
            let tracksToParse = [];
            this.tracks = [];

            if (typeof tracksCode === 'string') {
                tracksToParse = JSON.parse(tracksCode);
            }
            else {
                tracksToParse = tracksCode;
            }
            
            
            tracksToParse.forEach((track) => {
                let target = {};

                //-- Find track target in scene based on trackid
                if (track.id.indexOf('App') > -1) {
                    target = eval(track.id);
                }
                else { //-- Otherwise look in userScene for object.
                    userScene.children.forEach((child) => {
                        if (child.name === track.id.substr(0, track.id.indexOf('.'))) {
                            let targetProperty = track.targetName.replace(child.name + '.', '');
                            target = child[targetProperty];
                        }
                    });

                    if (!target) { //-- If not found, console and skip.
                        console.log("Track parsing skipped as target was not found for:", track.id);
                        return;
                    }
                }

                switch (track.type) {
                    case 'keyframe':
                        let keysTrack = new Tracks.Keyframe(track.id, target, this);

                        //Iterate the keysMap
                        for (let key in track.keysMap) {
                            keysTrack.rebuildKeysMapProperty(key, track.keysMap[key]);
                        }
                        
                        break;

                    case 'number':
                        let numberTrack = new Tracks.Number(track.id, this, track.followInputTarget, track.sampleRate, track.inputModifier);
                        numberTrack.data = track.data;
                        break;

                    case 'position':
                        let positionTrack = new Tracks.Position(track.id, this, track.followInputTarget, track.sampleRate, track.inputModifier);
                        positionTrack.data = track.data;
                        break;
                }

            });

            this.findAnimationEnd();
        }
        catch (e) {
            alert('Failed setting up Timeline code', e);
        }
    }
    /**
     * Iterate animation values and apply the values with the proper duration and easing.
     */
    applyValues() {
        if(!this.playing) return;
        for (let i = 0; i < this.tracks.length; i++) {
            // If recording, check to see if in accordance with sample rate value
            // and ready for next tick in data saving.
            if (this.tracks[i].recording) {
                let recordingTrack = this.tracks[i];

                if (recordingTrack.nextTick > this.endTime) {
                    recordingTrack.nextTick = 0;
                }

                //- Calculate and check spot in array, if occupied, replace, if none, push.
                if (recordingTrack.nextTick >= this.time && this.playing) {
                    let dataIndex = Math.floor(recordingTrack.nextTick / recordingTrack.sampleRate);
                    let value = recordingTrack.getTargetValue()
                    if (recordingTrack.type === 'number') {
                        recordingTrack.data[dataIndex] = value;
                    }
                    else if (recordingTrack.type === 'position') {
                        recordingTrack.data.x[dataIndex] = value[0];
                        recordingTrack.data.y[dataIndex] = value[1];
                        recordingTrack.data.z[dataIndex] = value[2];
                    }

                }
                else if(recordingTrack.nextTick < this.time && this.playing) {
                    recordingTrack.nextTick += recordingTrack.sampleRate;
                }
            }

            if (!this.tracks[i].keysMap) continue;

            //Iterate the keys in the track map
            for (let property in this.tracks[i].keysMap) {
                let keys = this.tracks[i].keysMap[property].keys;

                if (this.tracks[i].keysMap[property].following) {
                    keys = this.tracks[i].keysMap[property].followKeys
                }

                for (let z = 0; z < keys.length; z++) {
                    let currentTrack = keys[z];

                    if (this.time < currentTrack.startTime || currentTrack.hasEnded) {
                        continue;
                    }

                    if (this.time >= currentTrack.startTime && !currentTrack.hasStarted) {
                        let startValue = currentTrack.target[currentTrack.propertyName];
                        if (startValue.length && startValue.indexOf('px') > -1) {
                            currentTrack.startValue = Number(startValue.replace('px', ''));
                            currentTrack.unit = 'px';
                        }
                        else {
                            currentTrack.startValue = startValue;
                        }
                        currentTrack.hasStarted = true;
                    }

                    let duration = currentTrack.endTime - currentTrack.startTime;
                    let t = duration ? (this.time - currentTrack.startTime) / (duration) : 1;
                    let easeType = currentTrack.easing.substr(0, currentTrack.easing.indexOf("."));
                    let easeBezier = currentTrack.easing.substr(currentTrack.easing.indexOf(".") + 1, currentTrack.easing.length);

                    t = Math.max(0, Math.min(t, 1));
                    t = Easing[easeType][easeBezier](t);

                    let value = currentTrack.startValue + (currentTrack.endValue - currentTrack.startValue) * t;

                    if (currentTrack.unit) value += currentTrack.unit;
                    currentTrack.target[currentTrack.propertyName] = value;

                    if (currentTrack.parent && currentTrack.parent.onUpdateCallback) {
                        currentTrack.parent.onUpdateCallback(currentTrack);
                    }

                    if (this.time >= currentTrack.endTime && !currentTrack.hasEnded) {
                        currentTrack.hasEnded = true;
                    }

                    if (t == 1) {
                        if (this.loopMode == 0) {
                            this.tracks.splice(i, 1);
                            i--;
                        }
                    }
                }
            }
        }
    }
}

module.exports = Timeline;