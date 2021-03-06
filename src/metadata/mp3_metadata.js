"use strict";

import { Uint8Array, Blob } from "platform/platform";
import { readBit } from "util";
import { MD5 } from "jsmd5";
import demux from "audio/demuxer";
import { TextDecoder } from "text_codec";

const ID3 = 0x494433|0;
const TAG = 0x544147|0;

const id3v1Genres = [
    "Blues","Classic Rock","Country","Dance","Disco","Funk","Grunge",
    "Hip-Hop","Jazz","Metal","New Age","Oldies","Other","Pop","Rhythm and Blues",
    "Rap","Reggae","Rock","Techno","Industrial","Alternative","Ska","Death Metal",
    "Pranks","Soundtrack","Euro-Techno","Ambient","Trip-Hop","Vocal","Jazz & Funk",
    "Fusion","Trance","Classical","Instrumental","Acid","House","Game","Sound Clip",
    "Gospel","Noise","Alternative Rock","Bass","Soul","Punk","Space","Meditative",
    "Instrumental Pop","Instrumental Rock","Ethnic","Gothic","Darkwave","Techno-Industrial",
    "Electronic","Pop-Folk","Eurodance","Dream","Southern Rock","Comedy","Cult","Gangsta",
    "Top 40","Christian Rap", ["Pop", "Funk"],"Jungle","Native US","Cabaret","New Wave",
    "Psychedelic","Rave","Showtunes","Trailer","Lo-Fi","Tribal","Acid Punk","Acid Jazz",
    "Polka","Retro","Musical","Rock ’n’ Roll","Hard Rock","Folk","Folk-Rock","National Folk",
    "Swing","Fast Fusion","Bebop","Latin","Revival","Celtic","Bluegrass","Avantgarde",
    "Gothic Rock","Progressive Rock","Psychedelic Rock","Symphonic Rock","Slow Rock",
    "Big Band","Chorus","Easy Listening","Acoustic","Humour","Speech","Chanson","Opera",
    "Chamber Music","Sonata","Symphony","Booty Bass","Primus","Porn Groove","Satire",
    "Slow Jam","Club","Tango","Samba","Folklore","Ballad","Power Ballad","Rhythmic Soul",
    "Freestyle","Duet","Punk Rock","Drum Solo","A cappella","Euro-House","Dance Hall","Goa",
    "Drum & Bass","Club-House","Hardcore Techno","Terror","Indie","BritPop","Negerpunk",
    "Polsk Punk","Beat","Christian Gangsta Rap","Heavy Metal","Black Metal","Crossover",
    "Contemporary Christian","Christian Rock","Merengue","Salsa","Thrash Metal","Anime",
    "Jpop","Synthpop","Abstract","Art Rock","Baroque","Bhangra","Big Beat","Breakbeat",
    "Chillout","Downtempo","Dub","EBM","Eclectic","Electro","Electroclash","Emo","Experimental",
    "Garage","Global","IDM","Illbient","Industro-Goth","Jam Band","Krautrock","Leftfield",
    "Lounge","Math Rock","New Romantic","Nu-Breakz","Post-Punk","Post-Rock","Psytrance",
    "Shoegaze","Space Rock","Trop Rock","World Music","Neoclassical","Audiobook","Audio Theatre",
    "Neue Deutsche Welle","Podcast","Indie Rock","G-Funk","Dubstep","Garage Rock","Psybient"
];

const pictureKinds = [
    "Other", "32x32 pixels 'file icon'", "Other file icon",
    "Cover (front)", "Cover (back)", "Leaflet page", "Media (e.g. lable side of CD)",
    "Lead artist/lead performer/soloist", "Artist/performer", "Conductor", "Band/Orchestra",
    "Composer", "Lyricist/text writer", "Recording Location", "During recording",
    "During performance", "Movie/video screen capture", "A bright coloured fish", "Illustration",
    "Band/artist logotype", "Publisher/Studio logotype"
];

const decoders = [
    new TextDecoder("iso-8859-1"),
    new TextDecoder("utf-16"),
    new TextDecoder("utf-16be"),
    new TextDecoder("utf-8")
];

const id3v2String = function(fieldName) {
    return function(offset, fileView, flags, version, size, data) {
        var encoding = fileView.getUint8(offset);
        offset++;
        var buffer = fileView.block();
        var start = fileView.start;
        var nullLength = (encoding === 1 || encoding === 2) ? 2 : 1;
        var length = distanceUntilNull(offset - start, buffer, size - 1, nullLength);

        if (length > 0) {
            var strBytes = new Uint8Array(buffer.buffer, offset - start, length);
            var decoder = decoders[encoding];

            if (decoder) {
                var result = decoder.decode(strBytes).trim();

                if (result.length > 512) {
                    result = result.slice(0, 512);
                }

                if (typeof fieldName === "function") {
                    fieldName(data, result);
                } else {
                    data[fieldName] = result;
                }
            }
        }
    };
};

const distanceUntilNull = function(offset, buffer, maxLength, nullLength) {
    for (var j = 0; j < maxLength; j += nullLength) {
        var i = offset + j;
        if (buffer[i] === 0 && (nullLength === 2 ? buffer[i + 1] === 0 : true)) {
            return j;
        }
    }
    return maxLength;
};

const rnumdenom = /\s*(\d+)\s*\/\s*(\d+)/;
const tagMap = {};


tagMap[0x545031|0] = tagMap[0x54504531|0] = id3v2String("artist");
tagMap[0x545432|0] = tagMap[0x54495432|0] = id3v2String("title");
tagMap[0x54414C|0] = tagMap[0x54414C42|0] = id3v2String("album");
tagMap[0x544d4f4f|0] = id3v2String("mood");
tagMap[0x545332|0] = tagMap[0x54534F32|0] = tagMap[0x545032|0] = tagMap[0x54504532|0] = id3v2String("albumArtist");
tagMap[0x54524B|0] = tagMap[0x5452434B|0] = id3v2String(function(data, result) {
    var m = rnumdenom.exec(result);
    if (m) {
        data.albumIndex = +m[1];
        data.trackCount = +m[2];
    } else {
        data.albumIndex = +result;
        data.trackCount = -1;
    }
});
tagMap[0x545041|0] = tagMap[0x54504F53|0] = id3v2String(function(data, result) {
    var m = rnumdenom.exec(result);
    if (m) {
        data.discNumber = +m[1];
        data.discCount = +m[2];
    } else {
        data.discNumber = +result;
        data.discCount = -1;
    }
});
tagMap[0x544350|0] = tagMap[0x54434D50|0] = id3v2String(function(data, result) {
    data.compilationFlag = result === "1";
    if (data.compilationFlag && !data.albumArtist) {
        data.albumArtist = "Various Artists";
    }
});

tagMap[0x544250|0] = tagMap[0x5442504d|0] = id3v2String(function(data, result) {
    data.beatsPerMinute = +result;
});

tagMap[0x545945|0] = tagMap[0x54594552|0] = id3v2String(function(data, result) {
    data.year = +result;
});

const rgenre = /\((\d+)\)/g;
tagMap[0x54434f|0] = tagMap[0x54434f4e|0] = id3v2String(function(data, result) {
    var lastIndex = 0;
    var genres = {};
    var m;
    while (m = rgenre.exec(result)) {
        lastIndex = rgenre.lastIndex;
        var genre = id3v1Genres[+m[1]];

        if (!Array.isArray(genre)) {
            genre = [genre];
        }

        for (var i = 0; i < genre.length; ++i) {
            genres[genre[i].toLowerCase()] = genre[i];
        }
    }

    var rest = result.slice(lastIndex).trim();

    if (rest) {
        var multi = rest.split(/\s*\/\s*/g);
        for (var i = 0; i < multi.length; ++i) {
            var genre = multi[i].trim();
            genres[genre.toLowerCase()] = genre;
        }
    }

    data.genres = Object.keys(genres).map(function(key) {
        return genres[key];
    });
});

tagMap[0x504943|0] = tagMap[0x41504943|0] = function(offset, fileView, flags, version, size, data) {
    var originalOffset = offset;
    var encoding = fileView.getUint8(offset);
    offset++;
    var type;
    var buffer = fileView.block();
    var start = fileView.start;
    var pictureKind = -1;
    var decoder = decoders[encoding];

    if (!decoder) return;

    var nullLength = (encoding === 1 || encoding === 2) ? 2 : 1;

    if (version <= 2) {
        type = "image/" + decoder.decode(new Uint8Array(buffer.buffer, offset - start, 3));
        offset += 3;
    } else {
        var length = distanceUntilNull(offset - start, buffer, size - (offset - originalOffset), 1);
        var typeString = decoder.decode(new Uint8Array(buffer.buffer, offset - start, length)).toLowerCase();
        offset += (length + 1);

        if (typeString.indexOf("/") === -1) {
            if (/jpg|jpeg|png/.test(typeString)) {
                type = "image/" + typeString;
            } else {
                return;
            }
        } else {
            type = typeString.toLowerCase();
        }
    }

    pictureKind = fileView.getUint8(offset);
    offset++;

    var length = distanceUntilNull(offset - start, buffer, size - (offset - originalOffset), nullLength);
    var description = decoder.decode(new Uint8Array(buffer.buffer, offset - start, length));
    offset += (length + nullLength);

    var dataLength = size - (offset - originalOffset);
    var start = fileView.start + offset;

    var pictures = data.pictures;
    if (!pictures) {
        pictures = [];
        data.pictures = pictures;
    }

    var data;
    if (flags.hasBeenUnsynchronized) {
        data = new Uint8Array(dataLength);
        var actualLength = 0;
        for (var j = 0; j < dataLength; ++j) {
            var i = offset - fileView.start + j;
            var value = buffer[i];
            if (value === 0xFF &&
                ((i + 1) < buffer.length) &&
                buffer[i + 1] === 0x00) {
                ++j;
            }
            data[actualLength] = value;
            actualLength++;
        }
        if (actualLength !== dataLength) {
            data = new Uint8Array(data.buffer, offset - fileView.start, actualLength);
        }
    } else {
        data = new Uint8Array(buffer.buffer, offset - fileView.start, dataLength);
    }

    var tag = MD5(data);
    var dataBlob = new Blob([data], {type: type});

    pictures.push({
        tag: tag,
        blob: dataBlob,
        blobUrl: null,
        image: null,
        pictureKind: pictureKinds[pictureKind],
        description: description
    });
};

const hex8 = "[0-9A-F]{8}";
const hex8Capture = "([0-9A-F]{8})";
const hex16 = "[0-9A-F]{16}";
const riTunesGapless = new RegExp([hex8, hex8Capture, hex8Capture, hex16, hex8, hex8, hex8, hex8, hex8, hex8, hex8].join(" "));
tagMap[0x434f4d4d|0] = tagMap[0x434f4d|0] = function(offset, fileView, flags, version, size, data) {
    var originalOffset = offset;
    var encoding = fileView.getUint8(offset);
    var buffer = fileView.block();
    offset++;
    decoders[0].decode(new Uint8Array(buffer.buffer, offset - fileView.start, 3));
    offset += 3;

    var decoder = decoders[encoding];
    if (!decoder) return;

    var nullLength = (encoding === 1 || encoding === 2) ? 2 : 1;
    var length = distanceUntilNull(offset - fileView.start, buffer, size - 4, nullLength);
    var key = decoder.decode(new Uint8Array(buffer.buffer, offset - fileView.start, length));

    offset += (length + nullLength);
    length = distanceUntilNull(offset - fileView.start, buffer, (size - (offset - originalOffset)), nullLength);
    var value = decoder.decode(new Uint8Array(buffer.buffer, offset - fileView.start, length));

    if (key === "iTunSMPB" || key === "") {
        var matches = riTunesGapless.exec(value.trim());
        if (matches) {
            data.encoderDelay = parseInt(matches[1], 16);
            data.encoderDelay = Math.min(65536, Math.max(0, data.encoderDelay));
            data.encoderPadding = parseInt(matches[2], 16);
            data.encoderPadding = Math.min(65536, Math.max(0, data.encoderPadding));
        }
    }
};

const synchIntAt = function(fileView, offset) {
    return (fileView.getUint8(offset) << 21) |
          (fileView.getUint8(offset + 1) << 14) |
          (fileView.getUint8(offset + 2) << 7) |
          fileView.getUint8(offset + 3);
};

const getFlags = function(fileView, offset, version) {
    var tagAlterPreservation = false;
    var fileAlterPreservation = false;
    var readOnly = false;
    var containsGroupInfo = false;
    var isCompressed = false;
    var isEncrypted = false;
    var hasBeenUnsynchronized = false;
    var hasDataLengthIndicator = false;

    if (version >= 3) {
        var bits = fileView.getUint16(offset);
        tagAlterPreservation = readBit(bits, 14);
        fileAlterPreservation = readBit(bits, 13);
        readOnly = readBit(bits, 12);
        containsGroupInfo = readBit(bits, 6);
        isCompressed = readBit(bits, 3);
        isEncrypted = readBit(bits, 2);
        hasBeenUnsynchronized = readBit(bits, 1);
        hasDataLengthIndicator = readBit(bits, 0);
    }

    return {
        tagAlterPreservation: tagAlterPreservation,
        fileAlterPreservation: fileAlterPreservation,
        readOnly: readOnly,
        containsGroupInfo: containsGroupInfo,
        isCompressed: isCompressed,
        isEncrypted: isEncrypted,
        hasBeenUnsynchronized: hasBeenUnsynchronized,
        hasDataLengthIndicator: hasDataLengthIndicator
    };
};

const getMainFlags = function(fileView, offset) {
    var bits = fileView.getUint8(offset + 5);

    var hasBeenUnsynchronized = readBit(bits, 7);
    var isExtended = readBit(bits, 6);
    var isExperimental = readBit(bits, 5);
    var hasFooter = readBit(bits, 4);

    return {
        hasBeenUnsynchronized: hasBeenUnsynchronized,
        isExtended: isExtended,
        isExperimental: isExperimental,
        hasFooter: hasFooter,
        invalidBits: (bits & 0xF) !== 0
    };
};

const parseBasicInfo = function(fileView) {
    return demux("mp3", fileView, true, 262144).then(function(metadata) {
        if (!metadata) return null;
        return {
            sampleRate: metadata.sampleRate,
            channels: metadata.channels,
            duration: metadata.duration
        };
    });
};

const parseId3v2Data = function(data, fileView, offset) {
    var id3MetadataSize = synchIntAt(fileView, offset + 6);
    var version = fileView.getUint8(offset + 3);
    var mainFlags = getMainFlags(fileView, offset);
    var blockRead = Promise.resolve();
    if (!(2 <= version && version <= 4) || mainFlags.invalidBits) {
        return;
    }

    if (offset + id3MetadataSize + 10 + 3 > fileView.end) {
        blockRead = fileView.readBlockOfSizeAt(id3MetadataSize + 8192 + 3, offset);
    }

    return blockRead.then(function() {
        offset += 10;

        var end = offset + id3MetadataSize;
        var tagShift = version > 2 ? 0 : 8;
        var tagSize = version > 2 ? 4 : 3;
        var headerSize = version > 2 ? 10 : 6;

        if (mainFlags.isExtended) {
            offset += synchIntAt(fileView, offset);
        }

        while (offset + headerSize < end) {
            var tag = (fileView.getUint32(offset) >>> tagShift)|0;
            offset += tagSize;

            if (tag === 0) {
                continue;
            }

            var size = version > 3 ? synchIntAt(fileView, offset) : (fileView.getUint32(offset) >>> tagShift);
            offset += tagSize;
            var flags = getFlags(offset);
            if (version > 2) offset += 2;

            if (flags.hasDataLengthIndicator) {
                size = synchIntAt(fileView, offset);
                offset += 4;
            }

            flags.hasBeenUnsynchronized = flags.hasBeenUnsynchronized || mainFlags.hasBeenUnsynchronized;

            if (flags.hasBeenUnsynchronized && !flags.hasDataLengthIndicator) {
                var buffer = fileView.block();
                var start = fileView.start;
                for (var j = 0; j < size; ++j) {
                    var i = offset + j - start;
                    if (buffer[i] === 0xFF && buffer[i + 1] === 0) {
                        size++;
                    }
                }
            }

            var handler = tagMap[tag];

            if (handler) {
                handler(offset, fileView, flags, version, size, data);
            }

            offset += size;
        }

        if (mainFlags.hasFooter) {
            offset += 10;
        }

        while (offset + headerSize < fileView.end) {
            var tag = fileView.getUint32(offset);
            if ((tag >>> 8) === ID3) {
                return parseId3v2Data(data, fileView, offset);
            } else if (tag !== 0) {
                break;
            }
            offset += 4;
        }
    });
};

const getId3v1String = function(fileView, offset) {
    var buffer = fileView.block();
    var length = 30;
    for (var i = 0; i < 30; ++i) {
        if (buffer[offset + i - fileView.start] === 0) {
            length = i;
            break;
        }
    }
    var decoder = decoders[0];
    return decoder.decode(new Uint8Array(buffer.buffer, offset - fileView.start, length));
};

const parseId3v1Data = function(data, fileView) {
    var start = fileView.file.size - 128;
    return fileView.readBlockOfSizeAt(128, start).then(function() {
        var offset = start;
        var decoder = decoders[0];
        var buffer = fileView.block();
        if (((fileView.getUint32(offset) >>> 8)|0) === TAG) {
            offset += 3;
            var title = getId3v1String(fileView, offset);
            offset += 30;
            var artist = getId3v1String(fileView, offset);
            offset += 30;
            var album = getId3v1String(fileView, offset);
            offset += 30;
            var year = decoder.decode(new Uint8Array(buffer.buffer, offset - fileView.start, 4));
            offset += 4;
            var comment = fileView.getUint16(offset + 28);
            var trackIndex = -1;
            if ((comment & 0xFF00) === 0) {
                trackIndex = comment & 0xFF;
            }
            offset += 30;
            var genre = id3v1Genres[fileView.getUint8(offset)];
            data.title = title;
            data.artist = artist;
            data.album = album;
            data.year = +year;

            if (trackIndex !== -1) {
                data.trackIndex = trackIndex;
            }
            data.genres = Array.isArray(genre) ? genre.slice() : [genre];
        }
    });
};

export default function parseMp3Metadata(data, fileView) {
    return parseBasicInfo(fileView).then(function(basicInfo) {
        if (basicInfo) data.basicInfo = basicInfo;
        const length = 16384;
        return fileView.readBlockOfSizeAt(length, 0).then(function() {
            if (fileView.end < length) return null;
            var header = 0;
            var buffer = fileView.block();

            for (var i = 0; i < length; ++i) {
                header = ((header << 8) | buffer[i]) | 0;
                if ((header >>> 8) === ID3) {
                    var maybeId3v2 = parseId3v2Data(data, fileView, i - 3);
                    if (maybeId3v2) {
                        return maybeId3v2;
                    }
                }
            }

            return parseId3v1Data(data, fileView);
        }).return(data);
    });
}
