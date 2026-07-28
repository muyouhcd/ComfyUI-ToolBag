import assert from "node:assert/strict";
import test from "node:test";

import {
    getModelScopeLink,
    rewriteWorkflowModelUrls,
    toModelScopeUrl,
} from "../js/modelscope_url.mjs";

test("converts Hugging Face file URLs to ModelScope", () => {
    assert.equal(
        toModelScopeUrl(
            "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors?download=true",
            "ae.safetensors",
        ),
        "https://www.modelscope.cn/models/Comfy-Org/z_image_turbo/resolve/master/split_files/vae/ae.safetensors",
    );
});

test("uses ModelScope search for sources without a direct mirror mapping", () => {
    assert.equal(
        toModelScopeUrl(
            "https://example.com/files/model.safetensors",
            "model.safetensors",
        ),
        "https://www.modelscope.cn/search?from=opensearch&search=model.safetensors",
    );
});

test("rewrites workflow and node model metadata", () => {
    const workflow = {
        models: [
            {
                name: "root.safetensors",
                url: "https://huggingface.co/Comfy-Org/root/resolve/main/root.safetensors",
            },
        ],
        nodes: [
            {
                properties: {
                    models: [
                        {
                            name: "node.safetensors",
                            url: "https://civitai.com/api/download/models/123",
                        },
                    ],
                },
            },
        ],
    };
    const models = new Map();
    const links = rewriteWorkflowModelUrls(workflow, new Map(), models);

    assert.equal(
        workflow.models[0].url,
        "https://www.modelscope.cn/models/Comfy-Org/root/resolve/master/root.safetensors",
    );
    assert.equal(
        workflow.nodes[0].properties.models[0].url,
        "https://www.modelscope.cn/search?from=opensearch&search=node.safetensors",
    );
    assert.equal(
        getModelScopeLink("node.safetensors", links),
        workflow.nodes[0].properties.models[0].url,
    );
    assert.deepEqual(models.get("root.safetensors"), {
        name: "root.safetensors",
        url: workflow.models[0].url,
        directory: undefined,
    });
});
