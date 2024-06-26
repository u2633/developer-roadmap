const fs = require('fs');
const path = require('path');

const OPEN_AI_API_KEY = process.env.OPEN_AI_API_KEY;
const ALL_ROADMAPS_DIR = path.join(__dirname, '../src/data/roadmaps');

const roadmapId = process.argv[2];

const allowedRoadmapIds = fs.readdirSync(ALL_ROADMAPS_DIR);
if (!roadmapId) {
  console.error('roadmapId is required');
  process.exit(1);
}

if (!allowedRoadmapIds.includes(roadmapId)) {
  console.error(`Invalid roadmap key ${roadmapId}`);
  console.error(`Allowed keys are ${allowedRoadmapIds.join(', ')}`);
  process.exit(1);
}

const ROADMAP_CONTENT_DIR = path.join(ALL_ROADMAPS_DIR, roadmapId, 'content');
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: OPEN_AI_API_KEY,
});

function getFilesInFolder(folderPath, fileList = {}) {
  const files = fs.readdirSync(folderPath);

  files.forEach((file) => {
    const filePath = path.join(folderPath, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      getFilesInFolder(filePath, fileList);
    } else if (stats.isFile()) {
      const fileUrl = filePath
        .replace(ROADMAP_CONTENT_DIR, '') // Remove the content folder
        .replace(/\/\d+-/g, '/') // Remove ordering info `/101-ecosystem`
        .replace(/\/index\.md$/, '') // Make the `/index.md` to become the parent folder only
        .replace(/\.md$/, ''); // Remove `.md` from the end of file

      fileList[fileUrl] = filePath;
    }
  });

  return fileList;
}

/**
 * Write the topic content for the given topic
 * @param currTopicUrl
 * @returns {Promise<string>}
 */
function writeTopicContent(currTopicUrl) {
  const [parentTopic, childTopic] = currTopicUrl
    .replace(/^\d+-/g, '/')
    .replace(/:/g, '/')
    .replace(/^\//, '')
    .split('/')
    .slice(-2)
    .map((topic) => topic.replace(/-/g, ' '));

  const roadmapTitle = roadmapId.replace(/-/g, ' ');

  let prompt = `I will give you a topic and you need to write a brief introduction for that with regards to "${roadmapTitle}". Your format should be as follows and be in strictly markdown format:

# (Put a heading for the topic without adding parent "Subtopic in Topic" or "Topic in Roadmap" etc.)

(Write me a brief introduction for the topic with regards to "${roadmapTitle}")

(add any code snippets ONLY if necessary and makes sense)

`;

  if (!childTopic) {
    prompt += `First topic is: ${parentTopic}`;
  } else {
    prompt += `First topic is: ${childTopic} under ${parentTopic}`;
  }

  console.log(`Generating '${childTopic || parentTopic}'...`);

  return new Promise((resolve, reject) => {
    openai.chat.completions
      .create({
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      })
      .then((response) => {
        const article = response.choices[0].message.content;

        resolve(article);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

async function writeFileForGroup(group, topicUrlToPathMapping) {
  const topicId = group?.properties?.controlName;
  const topicTitle = group?.children?.controls?.control?.find(
    (control) => control?.typeID === 'Label',
  )?.properties?.text;
  const currTopicUrl = topicId?.replace(/^\d+-/g, '/')?.replace(/:/g, '/');
  if (!currTopicUrl) {
    return;
  }

  const contentFilePath = topicUrlToPathMapping[currTopicUrl];

  if (!contentFilePath) {
    console.log(`Missing file for: ${currTopicUrl}`);
    return;
  }

  const currentFileContent = fs.readFileSync(contentFilePath, 'utf8');
  const isFileEmpty = currentFileContent.replace(/^#.+/, ``).trim() === '';

  if (!isFileEmpty) {
    console.log(`Ignoring ${topicId}. Not empty.`);
    return;
  }

  let newFileContent = `# ${topicTitle}`;

  if (!OPEN_AI_API_KEY) {
    console.log(`Writing ${topicId}..`);

    fs.writeFileSync(contentFilePath, newFileContent, 'utf8');
    return;
  }

  const topicContent = await writeTopicContent(currTopicUrl);

  console.log(`Writing ${topicId}..`);
  fs.writeFileSync(contentFilePath, topicContent, 'utf8');

  // console.log(currentFileContent);
  // console.log(currTopicUrl);
  // console.log(topicTitle);
  // console.log(topicUrlToPathMapping[currTopicUrl]);
}

async function run() {
  const topicUrlToPathMapping = getFilesInFolder(ROADMAP_CONTENT_DIR);

  const roadmapJson = require(
    path.join(ALL_ROADMAPS_DIR, `${roadmapId}/${roadmapId}`),
  );

  const groups = roadmapJson?.mockup?.controls?.control?.filter(
    (control) =>
      control.typeID === '__group__' &&
      !control.properties?.controlName?.startsWith('ext_link'),
  );

  if (!OPEN_AI_API_KEY) {
    console.log('----------------------------------------');
    console.log('OPEN_AI_API_KEY not found. Skipping openai api calls...');
    console.log('----------------------------------------');
  }

  const writePromises = [];
  for (let group of groups) {
    writePromises.push(writeFileForGroup(group, topicUrlToPathMapping));
  }

  console.log('Waiting for all files to be written...');
  await Promise.all(writePromises);
}

run()
  .then(() => {
    console.log('Done');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
