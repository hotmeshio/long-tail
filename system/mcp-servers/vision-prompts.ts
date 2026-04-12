export const ANALYZE_IMAGE_PROMPT = `You are an image analysis assistant. Analyze the provided image and return a JSON object with the following structure:
{"description": "brief description of the image", "text_content": "any text visible in the image or null", "objects": ["list", "of", "notable", "objects"]}
Return ONLY the JSON object. No markdown, no explanation.`;

export const DESCRIBE_IMAGE_PROMPT = `You are an image description assistant. Provide a clear, detailed description of the provided image. Return a JSON object:
{"description": "detailed description of the image"}
Return ONLY the JSON object. No markdown, no explanation.`;
