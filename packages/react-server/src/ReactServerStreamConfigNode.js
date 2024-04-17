/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Writable} from 'stream';
import {TextEncoder} from 'util';

type MightBeFlushable = {
  flush?: () => void,
  ...
};

export type Destination = Writable & MightBeFlushable;

export type PrecomputedChunk = Uint8Array;
export type Chunk = string;

export function scheduleWork(callback: () => void) {
  setImmediate(callback);
}

export function flushBuffered(destination: Destination) {
  // If we don't have any more data to send right now.
  // Flush whatever is in the buffer to the wire.
  if (typeof destination.flush === 'function') {
    // By convention the Zlib streams provide a flush function for this purpose.
    // For Express, compression middleware adds this method.
    destination.flush();
  }
}

function mergeUint8Arrays(uint8arrays) {
  const totalLength = uint8arrays.reduce(
    (total, uint8array) => total + uint8array.byteLength,
    0,
  );

  const result = new Uint8Array(totalLength);

  let offset = 0;
  uint8arrays.forEach(uint8array => {
    result.set(uint8array, offset);
    offset += uint8array.byteLength;
  });

  return result;
}

const VIEW_SIZE = 2048;
let currentView = null;
let writtenBytes = 0;
let destinationHasCapacity = true;

export function beginWriting(destination: Destination) {
  currentView = new Uint8Array(VIEW_SIZE);
  writtenBytes = 0;
  destinationHasCapacity = true;
}

function writeChunks(
  destination: Destination,
  chunks: (PrecomputedChunk | Chunk)[],
) {
  if (chunks.length === 0) {
    return;
  }

  // eslint-disable-next-line no-for-of-loops/no-for-of-loops
  // for (const mixChunk of chunks) {
  //   if (typeof mixChunk === 'string') {
  //     writeStringChunk(destination, mixChunk);
  //   } else {
  //     writeViewChunk(destination, mixChunk);
  //   }
  // }
  const waitToWriteArray: Uint8Array[] = [];
  function _writeToDestination(_destination, view) {
    waitToWriteArray.push(new Uint8Array(view));
  }
  // eslint-disable-next-line no-for-of-loops/no-for-of-loops
  for (const mixChunk of chunks) {
    if (typeof mixChunk === 'string') {
      const stringChunk = mixChunk;
      if (stringChunk.length === 0) {
        continue;
      }
      // maximum possible view needed to encode entire string
      if (stringChunk.length * 3 > VIEW_SIZE) {
        if (writtenBytes > 0) {
          _writeToDestination(
            destination,
            ((currentView: any): Uint8Array).subarray(0, writtenBytes),
          );
          currentView = new Uint8Array(VIEW_SIZE);
          writtenBytes = 0;
        }
        _writeToDestination(destination, textEncoder.encode(stringChunk));
        // return;
        continue;
      }

      let target: Uint8Array = (currentView: any);
      if (writtenBytes > 0) {
        target = ((currentView: any): Uint8Array).subarray(writtenBytes);
      }
      const {read, written} = textEncoder.encodeInto(stringChunk, target);
      writtenBytes += written;

      if (read < stringChunk.length) {
        _writeToDestination(destination, (currentView: any));
        currentView = new Uint8Array(VIEW_SIZE);
        writtenBytes = textEncoder.encodeInto(
          stringChunk.slice(read),
          currentView,
        ).written;
      }

      if (writtenBytes === VIEW_SIZE) {
        _writeToDestination(destination, (currentView: any));
        currentView = new Uint8Array(VIEW_SIZE);
        writtenBytes = 0;
      }
    } else {
      const chunk = mixChunk;
      if (chunk.byteLength === 0) {
        continue;
      }
      if (chunk.byteLength > VIEW_SIZE) {
        // this chunk may overflow a single view which implies it was not
        // one that is cached by the streaming renderer. We will enqueu
        // it directly and expect it is not re-used
        if (writtenBytes > 0) {
          _writeToDestination(
            destination,
            ((currentView: any): Uint8Array).subarray(0, writtenBytes),
          );
          currentView = new Uint8Array(VIEW_SIZE);
          writtenBytes = 0;
        }
        _writeToDestination(destination, chunk);
        continue;
      }

      let bytesToWrite = chunk;
      const allowableBytes =
        ((currentView: any): Uint8Array).length - writtenBytes;
      if (allowableBytes < bytesToWrite.byteLength) {
        // this chunk would overflow the current view. We enqueue a full view
        // and start a new view with the remaining chunk
        if (allowableBytes === 0) {
          // the current view is already full, send it
          _writeToDestination(destination, (currentView: any));
        } else {
          // fill up the current view and apply the remaining chunk bytes
          // to a new view.
          ((currentView: any): Uint8Array).set(
            bytesToWrite.subarray(0, allowableBytes),
            writtenBytes,
          );
          writtenBytes += allowableBytes;
          _writeToDestination(destination, (currentView: any));
          bytesToWrite = bytesToWrite.subarray(allowableBytes);
        }
        currentView = new Uint8Array(VIEW_SIZE);
        writtenBytes = 0;
      }
      ((currentView: any): Uint8Array).set(bytesToWrite, writtenBytes);
      writtenBytes += bytesToWrite.byteLength;

      if (writtenBytes === VIEW_SIZE) {
        _writeToDestination(destination, (currentView: any));
        currentView = new Uint8Array(VIEW_SIZE);
        writtenBytes = 0;
      }
    }
  }
  writeToDestination(destination, mergeUint8Arrays(waitToWriteArray));
}

/*
function writeStringChunks(destination: Destination, stringChunks: string[]) {
  if (stringChunks.length === 0) {
    return;
  }
  const waitToWriteArray: Uint8Array[] = [];
  function _writeToDestination(_destination, view) {
    waitToWriteArray.push(new Uint8Array(view));
  }
  // eslint-disable-next-line no-for-of-loops/no-for-of-loops
  for (const stringChunk of stringChunks) {
    if (stringChunk.length === 0) {
      continue;
    }
    // maximum possible view needed to encode entire string
    if (stringChunk.length * 3 > VIEW_SIZE) {
      if (writtenBytes > 0) {
        _writeToDestination(
          destination,
          ((currentView: any): Uint8Array).subarray(0, writtenBytes),
        );
        currentView = new Uint8Array(VIEW_SIZE);
        writtenBytes = 0;
      }
      _writeToDestination(destination, textEncoder.encode(stringChunk));
      // return;
      continue;
    }

    let target: Uint8Array = (currentView: any);
    if (writtenBytes > 0) {
      target = ((currentView: any): Uint8Array).subarray(writtenBytes);
    }
    const {read, written} = textEncoder.encodeInto(stringChunk, target);
    writtenBytes += written;

    if (read < stringChunk.length) {
      _writeToDestination(destination, (currentView: any));
      currentView = new Uint8Array(VIEW_SIZE);
      writtenBytes = textEncoder.encodeInto(
        stringChunk.slice(read),
        currentView,
      ).written;
    }

    if (writtenBytes === VIEW_SIZE) {
      _writeToDestination(destination, (currentView: any));
      currentView = new Uint8Array(VIEW_SIZE);
      writtenBytes = 0;
    }
  }
  writeToDestination(destination, mergeUint8Arrays(waitToWriteArray));
}
*/

// function writeStringChunk(destination: Destination, stringChunk: string) {
//   if (stringChunk.length === 0) {
//     return;
//   }
//   // maximum possible view needed to encode entire string
//   if (stringChunk.length * 3 > VIEW_SIZE) {
//     if (writtenBytes > 0) {
//       writeToDestination(
//         destination,
//         ((currentView: any): Uint8Array).subarray(0, writtenBytes),
//       );
//       currentView = new Uint8Array(VIEW_SIZE);
//       writtenBytes = 0;
//     }
//     writeToDestination(destination, textEncoder.encode(stringChunk));
//     return;
//   }

//   let target: Uint8Array = (currentView: any);
//   if (writtenBytes > 0) {
//     target = ((currentView: any): Uint8Array).subarray(writtenBytes);
//   }
//   const {read, written} = textEncoder.encodeInto(stringChunk, target);
//   writtenBytes += written;

//   if (read < stringChunk.length) {
//     writeToDestination(destination, (currentView: any));
//     currentView = new Uint8Array(VIEW_SIZE);
//     writtenBytes = textEncoder.encodeInto(stringChunk.slice(read), currentView)
//       .written;
//   }

//   if (writtenBytes === VIEW_SIZE) {
//     writeToDestination(destination, (currentView: any));
//     currentView = new Uint8Array(VIEW_SIZE);
//     writtenBytes = 0;
//   }
// }

/*
function writeViewChunks(destination: Destination, chunks: PrecomputedChunk[]) {
  if (chunks.length === 0) {
    return;
  }
  const waitToWriteArray: Uint8Array[] = [];
  function _writeToDestination(_destination, view) {
    waitToWriteArray.push(new Uint8Array(view));
  }
  // eslint-disable-next-line no-for-of-loops/no-for-of-loops
  for (const chunk of chunks) {
    if (chunk.byteLength === 0) {
      continue;
    }
    if (chunk.byteLength > VIEW_SIZE) {
      // this chunk may overflow a single view which implies it was not
      // one that is cached by the streaming renderer. We will enqueu
      // it directly and expect it is not re-used
      if (writtenBytes > 0) {
        _writeToDestination(
          destination,
          ((currentView: any): Uint8Array).subarray(0, writtenBytes),
        );
        currentView = new Uint8Array(VIEW_SIZE);
        writtenBytes = 0;
      }
      _writeToDestination(destination, chunk);
      continue;
    }

    let bytesToWrite = chunk;
    const allowableBytes =
      ((currentView: any): Uint8Array).length - writtenBytes;
    if (allowableBytes < bytesToWrite.byteLength) {
      // this chunk would overflow the current view. We enqueue a full view
      // and start a new view with the remaining chunk
      if (allowableBytes === 0) {
        // the current view is already full, send it
        _writeToDestination(destination, (currentView: any));
      } else {
        // fill up the current view and apply the remaining chunk bytes
        // to a new view.
        ((currentView: any): Uint8Array).set(
          bytesToWrite.subarray(0, allowableBytes),
          writtenBytes,
        );
        writtenBytes += allowableBytes;
        _writeToDestination(destination, (currentView: any));
        bytesToWrite = bytesToWrite.subarray(allowableBytes);
      }
      currentView = new Uint8Array(VIEW_SIZE);
      writtenBytes = 0;
    }
    ((currentView: any): Uint8Array).set(bytesToWrite, writtenBytes);
    writtenBytes += bytesToWrite.byteLength;

    if (writtenBytes === VIEW_SIZE) {
      _writeToDestination(destination, (currentView: any));
      currentView = new Uint8Array(VIEW_SIZE);
      writtenBytes = 0;
    }
  }
  writeToDestination(destination, mergeUint8Arrays(waitToWriteArray));
}
*/

// function writeViewChunk(destination: Destination, chunk: PrecomputedChunk) {
//   if (chunk.byteLength === 0) {
//     return;
//   }
//   if (chunk.byteLength > VIEW_SIZE) {
//     // this chunk may overflow a single view which implies it was not
//     // one that is cached by the streaming renderer. We will enqueu
//     // it directly and expect it is not re-used
//     if (writtenBytes > 0) {
//       writeToDestination(
//         destination,
//         ((currentView: any): Uint8Array).subarray(0, writtenBytes),
//       );
//       currentView = new Uint8Array(VIEW_SIZE);
//       writtenBytes = 0;
//     }
//     writeToDestination(destination, chunk);
//     return;
//   }

//   let bytesToWrite = chunk;
//   const allowableBytes = ((currentView: any): Uint8Array).length - writtenBytes;
//   if (allowableBytes < bytesToWrite.byteLength) {
//     // this chunk would overflow the current view. We enqueue a full view
//     // and start a new view with the remaining chunk
//     if (allowableBytes === 0) {
//       // the current view is already full, send it
//       writeToDestination(destination, (currentView: any));
//     } else {
//       // fill up the current view and apply the remaining chunk bytes
//       // to a new view.
//       ((currentView: any): Uint8Array).set(
//         bytesToWrite.subarray(0, allowableBytes),
//         writtenBytes,
//       );
//       writtenBytes += allowableBytes;
//       writeToDestination(destination, (currentView: any));
//       bytesToWrite = bytesToWrite.subarray(allowableBytes);
//     }
//     currentView = new Uint8Array(VIEW_SIZE);
//     writtenBytes = 0;
//   }
//   ((currentView: any): Uint8Array).set(bytesToWrite, writtenBytes);
//   writtenBytes += bytesToWrite.byteLength;

//   if (writtenBytes === VIEW_SIZE) {
//     writeToDestination(destination, (currentView: any));
//     currentView = new Uint8Array(VIEW_SIZE);
//     writtenBytes = 0;
//   }
// }

export function writeChunk(
  destination: Destination,
  chunks: (PrecomputedChunk | Chunk)[],
): void {
  writeChunks(destination, chunks);
  // if (typeof chunk === 'string') {
  //   writeStringChunks(destination, chunks);
  // } else {
  //   writeViewChunks(destination, ((chunks: any): PrecomputedChunk[]));
  // }
}

function writeToDestination(destination: Destination, view: Uint8Array) {
  const currentHasCapacity = destination.write(view);
  destinationHasCapacity = destinationHasCapacity && currentHasCapacity;
}

export function writeChunkAndReturn(
  destination: Destination,
  chunk: PrecomputedChunk | Chunk,
): boolean {
  writeChunk(destination, [chunk]);
  return destinationHasCapacity;
}

export function completeWriting(destination: Destination) {
  if (currentView && writtenBytes > 0) {
    destination.write(currentView.subarray(0, writtenBytes));
  }
  currentView = null;
  writtenBytes = 0;
  destinationHasCapacity = true;
}

export function close(destination: Destination) {
  destination.end();
}

const textEncoder = new TextEncoder();

export function stringToChunk(content: string): Chunk {
  return content;
}

export function stringToPrecomputedChunk(content: string): PrecomputedChunk {
  return textEncoder.encode(content);
}

export function closeWithError(destination: Destination, error: mixed): void {
  // $FlowFixMe: This is an Error object or the destination accepts other types.
  destination.destroy(error);
}
