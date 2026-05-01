// ==UserScript==
// @name         Grabby Spice
// @namespace    https://linktr.ee/danbario
// @version      1777604579957
// @description  Download SpicyChat characters as V2 cards.
// @author       Danbario
// @match        https://spicychat.ai/*
// @icon         https://external-content.duckduckgo.com/ip3/spicychatapp.com.ico
// @grant        none
// @require      https://unpkg.com/xhook@1.6.2/dist/xhook.min.js
// @require      https://cdn.sheetjs.com/crc-32-latest/package/crc32.js
// @run-at       document-start
// ==/UserScript==

/* globals xhook CRC32 */

// Global variables.
let debug = true;
let verbose = false;
let GSVer = "1777604579957";
let sName = "Grabby Spice";

let charCard;

let State = {
    charJSON: null,
    avatarURL: null,
    cachedCard: null
};

const specV2 = {
    "data": {
        "name": "",
        "description": "",
        "personality": "",
        "first_mes": "",
        "avatar": "none",
        "mes_example": "",
        "scenario": "",
        "creator_notes": "",
        "system_prompt": "",
        "post_history_instructions": "",
        "alternate_greetings": [],
        "tags": [],
        "creator": "",
        "character_version": "",
        "extensions": {}
    },
    "spec": "chara_card_v2",
    "spec_version": "2.0"
};

xhook.after(function(request, response) {
    if (request.url.match(/v2\/characters\/[a-f\d\-]+$/)) {
        if (response.status === 200) {
            const scJSON = JSON.parse(response.text);
            
            State.charJSON = buildCharDefs(scJSON);
            State.avatarURL = "https://cdn.nd-api.com/" + scJSON.avatar_url;
            State.cachedCard = null; 

            if (debug){console.log(sName+": Intercepted new character:", State.charJSON.data.name)};
            if (debug && verbose){console.log(State.charJSON)};

            initUI();
        }
    }
});

function formatDialogue(raw) {
    if (!raw) return "";

    return "<START>\n" + raw
        .trim()
        .replace(/\s*END_OF_DIALOG$/, "")   // Strip the last one
        .replace(/\s*END_OF_DIALOG\s*/g, "\n<START>\n")
        .trim();
}

function buildCharDefs(r){
    let charDefs = specV2;
    charDefs.data.name = r.name;
    charDefs.data.description = r.persona;
    charDefs.data.first_mes = r.greeting;
    charDefs.data.mes_example = formatDialogue(r.dialogue);
    charDefs.data.scenario = r.scenario;
    charDefs.data.creator_notes = r.title;
    if (Array.isArray(r.tags)) {
        r.tags.forEach( (v, i) => {
            charDefs.data.tags[i] = v;
        });
    };
    charDefs.data.creator = r.creator_username;
    return charDefs;
};

//Modified from https://gist.github.com/casamia918/a8daf164830bce1b6281e304ed1f91b0
async function loadImageFromBlob(url) {
    return new Promise((resolve, reject) => {
        window.fetch(url)
            .then(resp => resp.blob())
            .then(blob => {
            const urlFromBlob = window.URL.createObjectURL(blob);

            const image = new window.Image()
            image.src = urlFromBlob;
            image.crossOrigin = 'Anonymous';
            image.addEventListener('load', () => {
                //resolve(image);
                let canvas = document.createElement("canvas");
                canvas.width = image.width;
                canvas.height = image.height;
                var ctx = canvas.getContext("2d");
                ctx.drawImage(image, 0, 0);
                canvas.toBlob(resolve, "image/png");
            })
            image.addEventListener('error', reject);
        })
    })
};

async function buildImage(img, charJSON) {
    // This is gonna be fucking fun...
    //https://dev.exiv2.org/projects/exiv2/wiki/The_Metadata_in_PNG_files
    const encoder = new TextEncoder();

    const imgBuffer = await img.arrayBuffer();
    const imgBufferSize = imgBuffer.byteLength
    const imgBufferView = new Uint8Array(imgBuffer, 0, imgBufferSize - 12);

    // Sanatize unicode characters because base64.
    // Taken from https://stackoverflow.com/questions/31649362/how-to-make-json-stringify-encode-non-ascii-characters-in-ascii-safe-escaped-for
    let charJSONstr = JSON.stringify(charJSON);
    charJSONstr = charJSONstr.replace(/[\u007F-\uFFFF]/g, function(chr) {
        return "\\u" + ("0000" + chr.charCodeAt(0).toString(16)).substr(-4)
    })
    const chara = btoa(charJSONstr);
    if (debug && verbose){console.log(sName+": character card base64 (chara):");console.log(chara);};
    if (debug){console.log(sName+": chara length: "+chara.length)};

    // Set up the new buffer and go ahead and copy the image data into it sans IEND
    const newABLength = imgBufferSize + chara.length + 18
    if (debug){console.log(sName+": New Buffer Length: " + String(newABLength))};
    let cardBuffer = new ArrayBuffer(newABLength);
    let cardBDat = new Uint8Array(cardBuffer, 0, imgBufferSize - 12);
    cardBDat.set(imgBufferView);
    if (debug){console.log(sName+": cardBDat:");console.log(cardBDat);};

    // New metadata starts here, starting with the length.
    let cardBCharaLen = new Uint8Array(cardBuffer, imgBufferSize - 12, 4);
    if (debug && verbose){console.log(sName+": initial cardBCharaLen:");console.log(cardBCharaLen);};
    // Convert the number to hex and extend to four bytes
    let charaHexSize = (chara.length + 6).toString(16).toUpperCase();
    while (charaHexSize.length < 8) {
        charaHexSize = "0" + charaHexSize;
    }
    if (debug){console.log(sName+": charaHexSize: "+charaHexSize)};
    // Split hex string into an array of two-character strings
    const charaHexSizeArray = charaHexSize.match(/[\da-f]{1,2}/gi);
    // Set hexarray to view
    charaHexSizeArray.forEach(function(c, i){
        cardBCharaLen.set([parseInt(c, 16)], i)
    });
    if (debug){console.log(sName+": cardBCharaLen:");console.log(cardBCharaLen);};

    // Now the type and data chunks, done together to make the CRC easier and also type is just 4 bytes, so whatever.
    let cardBCharaTypeDat = new Uint8Array(cardBuffer, imgBufferSize - 8, chara.length + 10);
    cardBCharaTypeDat.set(encoder.encode("tEXtchara"),0);
    cardBCharaTypeDat.set(encoder.encode(chara),10);
    if (debug){console.log(sName+": cardBCharaTypeDat:");console.log(cardBCharaTypeDat)};

    // CRC chunk, made possible by SheetJS's JS-CRC32 library.
    let cardBCharaCRC = new Uint8Array(cardBuffer, newABLength - 16, 4);
    let charaCRC = (CRC32.buf(cardBCharaTypeDat,0)>>>0).toString(16)
    while (charaCRC.length < 8) {
        charaCRC = "0" + charaCRC;
    }
    let charaCRCArray = charaCRC.match(/[\da-f]{1,2}/gi);
    charaCRCArray.forEach(function(c, i){
        cardBCharaCRC.set([parseInt(c, 16)], i)
    });
    if (debug){console.log(sName+": Calculated CRC: " + charaCRC)};

    // Now the new IEND
    let cardBIEND = new Uint8Array(cardBuffer, newABLength - 12, 12);
    cardBIEND.set([0,0,0,0,73,69,78,68,174,66,96,130],0)

    // Boom, that should be a whole-ass fuckin' PNG with new metadata in memory.
    return new Blob([cardBuffer], {type: "image/png"})
};

function initUI() {
    // I have no idea if it's possible for this to be triggered on the wrong page,
    // but there are, like, three layers of validation here just in case.

    if (document.querySelector('a[aria-label^="chat-with"]') && window.location.href.includes("/chatbot")) {
        injectUI();
        return;
    }

    const uiObs = new MutationObserver((mutations, obs) => {
        if (document.querySelector('a[aria-label^="chat-with"]') && window.location.href.includes("/chatbot")) {
            injectUI();
            obs.disconnect();
        }
    });

    uiObs.observe(document.body, {
        childList: true,
        subtree: true
    });

    setTimeout(() => {
        uiObs.disconnect();
    }, 10000);
}

function injectUI() {
    let chatButton = document.querySelector('a[aria-label^="chat-with"]');
    if (!chatButton) return;
    let divButtons = chatButton.closest('div');
    if (!divButtons) return;

    if (document.getElementById("grabspice-btnDL")) return;

    const btnChatClass = chatButton
        .firstChild
        .getAttribute("class")
    const btnTextClass = chatButton
        .firstChild
        .lastChild
        .getAttribute("class")

    // Icon by Software Mansion
    // Licensed CC-BY
    // https://www.svgrepo.com/svg/506187/download
    const dlSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-square-more inline-flex items-center justify-center w-5 h-5">
                    <path d="M20 14V17.5C20 20.5577 16 20.5 12 20.5C8 20.5 4 20.5577 4 17.5V14M12 15L12 3M12 15L8 11M12 15L16 11" />
                </svg>`

    let btnDL = document.createElement("button");
    const btnDLText = dlSVG + `<p class="${btnTextClass}">Download Card</p>`;
    btnDL.setAttribute("type", "button");
    btnDL.setAttribute("class", btnChatClass);
    btnDL.setAttribute("id", "grabspice-btnDL");
    btnDL.innerHTML = btnDLText;
    
    btnDL.addEventListener('click', async () => {
        // This should be impossible to reach, tbh.
        if (!State.charJSON || !State.avatarURL) {
            console.warn("Grabby Spice: Button clicked, but character data isn't ready yet.");
            return; 
        }

        btnDL.disabled = true; 
        btnDL.innerHTML = `<p class="${btnTextClass}">Processing...</p>`;

        try {
            if (!State.cachedCard) {
                const charIMG = await loadImageFromBlob(State.avatarURL);
                State.cachedCard = await buildImage(charIMG, State.charJSON);
                if (debug){console.log(sName+": Card built and cached for", State.charJSON.data.name)};
            }

            let dlURL = URL.createObjectURL(State.cachedCard);
            let tempA = document.createElement("a");
            tempA.href = dlURL;
            tempA.download = State.charJSON.data.name.replace(/[\u007F-\uFFFF]/g,"") + "_v2.png";
            tempA.click();
            URL.revokeObjectURL(dlURL);

        } catch (err) {
            console.error(sName+": Export failed:", err);
            alert("Failed to generate card.");
        } finally {
            btnDL.disabled = false;
            btnDL.innerHTML = btnDLText;
        }
    });

    divButtons.insertBefore(btnDL, divButtons.children[1]);
    if (debug){console.log(sName+": Download button added")};
}

(()=>{console.log("Initializing Grabby Spice v." + GSVer)})();
