// @ts-nocheck
import fetch from 'node-fetch';

const toDownloadableUrl = (url: string): string => {
    let safeUrl = url.replace(/^http:\/\//i, 'https://');
    if (safeUrl.includes(' ') && !safeUrl.includes('%20')) {
        safeUrl = encodeURI(safeUrl);
    }
    if (!safeUrl.includes('cloudinary.com')) return safeUrl;
    if (safeUrl.includes('/raw/upload/')) return safeUrl;
    if (safeUrl.includes('/video/upload/')) return safeUrl;
    if (safeUrl.includes('/image/upload/')) {
        const lower = safeUrl.toLowerCase();
        const hasNonImageExt = lower.match(/\.(pdf|doc|docx|ppt|pptx|xls|xlsx|txt|zip|rar|csv)(\?|$)/);
        if (hasNonImageExt) {
            return safeUrl.replace('/image/upload/', '/raw/upload/');
        }
    }
    
    // Add fl_attachment to force download for standard images
    if (!safeUrl.includes('fl_attachment')) {
        // Find the upload/ part
        safeUrl = safeUrl.replace('/upload/', '/upload/fl_attachment/');
    }

    return safeUrl;
};

const urlsToTest = [
    'http://res.cloudinary.com/demo/image/upload/sample pdf.pdf', 
    'http://res.cloudinary.com/demo/image/upload/sample image.jpg', 
    'https://res.cloudinary.com/demo/video/upload/sample video.mp4', 
    'https://res.cloudinary.com/demo/raw/upload/sample.docx' 
];

async function runTest() {
    for (const url of urlsToTest) {
        const downloadUrl = toDownloadableUrl(url);
        console.log(`Original: ${url}\nDownload: ${downloadUrl}`);
    }
}

runTest();
