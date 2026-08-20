import { readProductGrounding } from "../core/product-grounding.mjs";

const model = await readProductGrounding(process.argv[2]);
process.stdout.write(JSON.stringify({
  modelVersion: model.version,
  feature: model.features[process.argv[3]],
}));
