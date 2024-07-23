import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
const readline = require('readline');

const detailedAsciiMap = [
    '-', '@', 'B', '%', '8', '&', 'W', 'M', '#', '*', 'C', 'J', 'U', 'Y', 'X', 'z', 'c', 'v', 'u', 'n', 'x', 'r', 'j', 'f', 't', '/', '\\', '|', '(', ')', '1', '{', '}', '[', ']', '?', '-', '_', '+', '~', '<', '>', 'i', '!', 'l', 'I', ';', ':', ',', '"', '^', '`', "'", '.', ' '
];

const textFramesFolder = 'textFrames';
const args = process.argv.slice(2);
const videoPath = args[0];
const videoWidth = parseInt(args[1]) || 100; // Default to 30 if not provided

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
    const frameFiles = fs.readdirSync(textFramesFolder)
        .filter(file => file.startsWith('ascii_frame_') && file.endsWith('.txt'))
        .sort((a: any, b: any) => {
            const numA = parseInt(a.match(/\d+/)[0]);
            const numB = parseInt(b.match(/\d+/)[0]);
            return numA - numB;
        });
    if (frameFiles.length === 0) {
        console.error("No ASCII frames found. Make sure ascii_frame_*.txt files are in the current directory.");
        return;
    }

    let frameIndex = 0;

    const { stdout } = process;

    function displayNextFrame() {
        if (frameIndex >= frameFiles.length) {
            frameIndex = 0; // Reset to start if we've shown all frames
        }
    
        const frameName = frameFiles[frameIndex];
        const frameContent = fs.readFileSync(`${textFramesFolder}/${frameName}`, 'utf8');
    
        // Prepare the frame off-screen
        let buffer = '\x1b[?25l'; // Hide cursor
        buffer += '\x1b[H'; // Move cursor to top-left corner
    
        // Add the frame content
        buffer += frameContent;
    
        // Clear any remaining lines
        // const lines = frameContent.split('\n').length;
        buffer += '\x1b[0J'; // Clear from cursor to end of screen
    
        // Write the entire buffer at once
        stdout.write(buffer);
    
        frameIndex++;
        setTimeout(displayNextFrame, delay);
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

async function main(video: string, outputWidth: number) {
    if (!fs.existsSync('textFrames')) {
        fs.mkdirSync('textFrames');
    }
    const videoPath = 'test.mp4';
    type FrameRate = number;
    let frameRate = await getVideoFrameRate(videoPath) as FrameRate;
    // fs.writeFileSync(`${textFramesFolder}/frame_rate.txt`, frameRate.toString());
    console.log(`Frame rate: ${frameRate}`);
    let asciiFrames = await videoToAscii(videoPath, outputWidth, frameRate) as any;
    asciiFrames.forEach((frame: any, index: number) => {
        fs.writeFileSync(`textFrames/ascii_frame_${index}.txt`, frame);
    });

    playAsciiFrames(frameRate);
}

if (!videoPath) {
    console.error("Please provide a video file path.");
    console.error("Usage: bun index.ts <video_file_path> [video_width]");
    process.exit(1);
}
function deleteTextFramesFolder() {
    if (fs.existsSync(textFramesFolder)) {
        fs.rmSync(textFramesFolder, { recursive: true, force: true });
        console.log(`\nDeleted folder: ${textFramesFolder}`);
    }
}

process.on('exit', deleteTextFramesFolder);
process.on('SIGINT', () => {
    console.log('\nCaught interrupt signal');
    process.exit();
});

main(videoPath, videoWidth);