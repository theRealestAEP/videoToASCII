import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
const { exec } = require('child_process');
const readline = require('readline');

const detailedAsciiMap = [
    '-', '@', 'B', '%', '8', '&', 'W', 'M', '#', '*', 'C', 'J', 'U', 'Y', 'X', 'z', 'c', 'v', 'u', 'n', 'x', 'r', 'j', 'f', 't', '/', '\\', '|', '(', ')', '1', '{', '}', '[', ']', '?', '-', '_', '+', '~', '<', '>', 'i', '!', 'l', 'I', ';', ':', ',', '"', '^', '`', "'", '.', ' '
];




function playAsciiFrames(frameRate = 30) {
    const delay = 1000 / frameRate; // in milliseconds

    console.log(`Original video frame rate: ${frameRate} fps`);
    console.log(`Delay between frames: ${delay} milliseconds`);
    console.log("Press Enter to start the animation...");

    // Create readline interface for user input
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('', () => {
        rl.close();
        startAnimation(delay);
    });
}

function startAnimation(delay: number) {
    // Get all frame files
    const frameFiles = fs.readdirSync('textFrames')
        .filter(file => file.startsWith('ascii_frame_') && file.endsWith('.txt'))
        .sort((a: any, b: any) => {
            const numA = parseInt(a.match(/\d+/)[0]);
            const numB = parseInt(b.match(/\d+/)[0]);
            return numA - numB;
        });
    console.log(frameFiles)
    if (frameFiles.length === 0) {
        console.error("No ASCII frames found. Make sure ascii_frame_*.txt files are in the current directory.");
        return;
    }

    let frameIndex = 0;

    function displayNextFrame() {
        if (frameIndex >= frameFiles.length) {
            frameIndex = 0; // Reset to start if we've shown all frames
        }

        const frameName = frameFiles[frameIndex];

        // Clear screen (works for Windows and Unix-like systems)
        process.stdout.write('\x1Bc');

        // Get terminal size
        // exec('tput cols && tput lines', (error: any, stdout: any, stderr: any) => {
        //     if (error) {
        //         console.error(`exec error: ${error}`);
        //         return;
        //     }

        //     const [cols, rows] = stdout.split('\n').map(Number);
        const frameContent = fs.readFileSync(`textFrames/${frameName}`, 'utf8');
        //     const contentHeight = frameContent.split('\n').length;

        // Calculate padding to center vertically
        // const padding = Math.max(0, Math.floor((rows - contentHeight) / 2));

        // // Add top padding
        // for (let i = 0; i < padding; i++) {
        //     console.log();
        // }

        // Display frame content
        console.log(frameContent);

        frameIndex++;
        setTimeout(displayNextFrame, delay);
        // });
    }

    displayNextFrame();
}

async function imageToMatrix(imagePath: string) {
    try {
        // Read the image
        const image = sharp(imagePath);

        // Get image metadata
        const metadata = await image.metadata();
        const { width, height } = metadata as { width: number; height: number };

        // Extract raw pixel data
        const { data } = await image
            .raw()
            .toBuffer({ resolveWithObject: true });

        // Create a 2D array to store pixel data
        const matrix = [];
        for (let y = 0; y < height; y++) {
            const row = [];
            for (let x = 0; x < width; x++) {
                const index = (y * width + x) * 3; // 3 channels: R, G, B
                const r = data[index];
                const g = data[index + 1];
                const b = data[index + 2];
                row.push([r, g, b]);
            }
            matrix.push(row);
        }

        return matrix;
    } catch (error) {
        console.error('Error processing image:', error);
    }
}

async function imageToAscii(imagePath: string, outputWidth: number) {
    try {
        // Read the image
        const image = sharp(imagePath);

        // Get image metadata
        const metadata = await image.metadata();
        const aspectRatio = metadata?.width! / metadata?.height!;

        // Calculate new dimensions
        const outputHeight = Math.round(outputWidth / aspectRatio);

        // Resize the image
        const { data, info } = await image
            .resize(outputWidth, outputHeight, { fit: 'fill' })
            .grayscale()
            .raw()
            .toBuffer({ resolveWithObject: true });

        // Convert pixel data to ASCII
        let asciiImage = '';
        for (let y = 0; y < info.height; y++) {
            for (let x = 0; x < info.width; x++) {
                const pixelIndex = y * info.width + x;
                const pixelBrightness = data[pixelIndex];
                const asciiChar = getAsciiChar(pixelBrightness);
                asciiImage += asciiChar;
            }
            asciiImage += '\n';
        }

        return asciiImage;
    } catch (error) {
        console.error('Error processing image:', error);
    }
}

async function getVideoFrameRate(videoPath: string) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
                reject(err);
            } else {
                const frameRate = metadata.streams[0].r_frame_rate;
                const [numerator, denominator] = frameRate!.split('/');
                resolve(Number(numerator) / Number(denominator));
            }
        });
    });
}

function getAsciiChar(brightness: number) {
    // console.log(brightness);
    const mapIndex = Math.floor((brightness / 255) * (detailedAsciiMap.length - 1));
    return detailedAsciiMap[mapIndex];
}

async function processFrames(directory: string, outputWidth: number) {
    const frames = fs.readdirSync(directory).sort((a: any, b: any) => {
        return parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]);
    });

    const asciiFrames = [];
    for (const frame of frames) {
        const framePath = path.join(directory, frame);
        const asciiFrame = await imageToAscii(framePath, outputWidth);
        asciiFrames.push(asciiFrame);
    }

    return asciiFrames;
}

async function videoToAscii(videoPath: string, outputWidth = 100, frameRate: number = 20) {
    const tempDir = 'temp_frames';
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
    }

    return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
            .fps(frameRate)
            .on('end', async () => {
                console.log('Frames extracted');
                const asciiFrames = await processFrames(tempDir, outputWidth);
                // Clean up temp directory
                fs.rmSync(tempDir, { recursive: true, force: true });
                resolve(asciiFrames);
            })
            .on('error', (err: any) => {
                console.error('Error:', err);
                reject(err);
            })
            .output(`${tempDir}/frame%d.png`)
            .run();
    });
}

async function main() {
    if (!fs.existsSync('textFrames')) {
        fs.mkdirSync('textFrames');
    }
    const videoPath = 'test.mp4';
    type FrameRate = number;
    let frameRate = await getVideoFrameRate(videoPath) as FrameRate;
    fs.writeFileSync('textFrames/frame_rate.txt', frameRate.toString());
    console.log(`Frame rate: ${frameRate}`);
    let asciiFrames = await videoToAscii(videoPath, 400, frameRate) as any;
    // .then((asciiFrames: any) => {
    //     console.log(`Converted ${asciiFrames.length} frames to ASCII`);
    //     // Here you can do something with the ASCII frames, like saving them to files or displaying them
    //     asciiFrames.forEach((frame: any, index: number) => {
    //         fs.writeFileSync(`textFrames/ascii_frame_${index}.txt`, frame);
    //     });
    // });
    asciiFrames.forEach((frame: any, index: number) => {
        fs.writeFileSync(`textFrames/ascii_frame_${index}.txt`, frame);
    });

    playAsciiFrames(frameRate);
}

main();