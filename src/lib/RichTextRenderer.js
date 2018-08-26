// import ObjectRenderer from 'pixi.js/lib/core/renderers/webgl/utils/ObjectRenderer';
// import WebGLRenderer from 'pixi.js/lib/core/renderers/webgl/WebGLRenderer';
// const PIXI = require('pixi.js');
// import * as PIXI from 'pixi.js';
const ObjectRenderer = PIXI.ObjectRenderer;
const WebGLRenderer = PIXI.WebGLRenderer;
import generateMultiTextureShader from './generateMultiTextureShader';
import createIndicesForQuads from './pixi-source/createIndicesForQuads';
import checkMaxIfStatmentsInShader from './pixi-source/checkMaxIfStatmentsInShader';
import BatchBuffer from './pixi-source/BatchBuffer';
// import settings from 'pixi.js/lib/core/settings';
// import glCore from 'pixi-gl-core';
import bitTwiddle from 'bit-twiddle';

const glCore = PIXI.glCore;
const settings = PIXI.settings;

let TICK = 0;
let TEXTURE_TICK = 0;

/**
 * Renderer dedicated to drawing and batching sprites.
 *
 * @class
 * @private
 * @memberof PIXI
 * @extends PIXI.ObjectRenderer
 */
export default class RichTextRenderer extends ObjectRenderer
{
    /**
     * @param {PIXI.WebGLRenderer} renderer - The renderer this sprite batch works for.
     */
    constructor(renderer)
    {
        super(renderer);

        /**
         * Number of values sent in the vertex buffer.
         * aVertexPosition(2), aTextureCoord(1), aColor(1), aTextureId(1) = 5
         * uShadow(1), uStroke(1), uFill(1), uGamma(1), uShadowColor(1), uStrokeColor(1), uFillColor(1) = 7
         * uShadowOffset(2), uShadowEnable(1), uStrokeEnable(1), uFillEnable(1), uShadowBlur = 6
         *
         * @member {number}
         */
        this.vertSize = 18;

        /**
         * The size of the vertex information in bytes.
         *
         * @member {number}
         */
        this.vertByteSize = this.vertSize * 4;

        /**
         * The number of images in the SpriteRenderer before it flushes.
         *
         * @member {number}
         */
        this.size = settings.SPRITE_BATCH_SIZE; // 2000 is a nice balance between mobile / desktop

        // the total number of bytes in our batch
        // let numVerts = this.size * 4 * this.vertByteSize;

        this.buffers = [];
        for (let i = 1; i <= bitTwiddle.nextPow2(this.size); i *= 2)
        {
            this.buffers.push(new BatchBuffer(i * 4 * this.vertByteSize));
        }

        /**
         * Holds the indices of the geometry (quads) to draw
         *
         * @member {Uint16Array}
         */
        this.indices = createIndicesForQuads(this.size);

        /**
         * The default shaders that is used if a sprite doesn't have a more specific one.
         * there is a shader for each number of textures that can be rendererd.
         * These shaders will also be generated on the fly as required.
         * @member {PIXI.Shader[]}
         */
        this.shader = null;

        this.currentIndex = 0;
        this.groups = [];

        for (let k = 0; k < this.size; k++)
        {
            this.groups[k] = { textures: [], textureCount: 0, ids: [], size: 0, start: 0, blend: 0 };
        }

        // this.sprites = [];

        this.meshes = [];

        this.vertexBuffers = [];
        this.vaos = [];

        this.vaoMax = 2;
        this.vertexCount = 0;

        this.renderer.on('prerender', this.onPrerender, this);
    }

    /**
     * Sets up the renderer context and necessary buffers.
     *
     * @private
     */
    onContextChange()
    {
        const gl = this.renderer.gl;

        if (this.renderer.legacy)
        {
            this.MAX_TEXTURES = 1;
        }
        else
        {
            // step 1: first check max textures the GPU can handle.
            this.MAX_TEXTURES = Math.min(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), settings.SPRITE_MAX_TEXTURES);

            // step 2: check the maximum number of if statements the shader can have too..
            this.MAX_TEXTURES = checkMaxIfStatmentsInShader(this.MAX_TEXTURES, gl);
        }

        this.shader = generateMultiTextureShader(gl, this.MAX_TEXTURES);

        // create a couple of buffers
        this.indexBuffer = glCore.GLBuffer.createIndexBuffer(gl, this.indices, gl.STATIC_DRAW);

        // we use the second shader as the first one depending on your browser may omit aTextureId
        // as it is not used by the shader so is optimized out.

        this.renderer.bindVao(null);

        const attrs = this.shader.attributes;

        for (let i = 0; i < this.vaoMax; i++)
        {
            /* eslint-disable max-len */
            const vertexBuffer = this.vertexBuffers[i] = glCore.GLBuffer.createVertexBuffer(gl, null, gl.STREAM_DRAW);
            /* eslint-enable max-len */

            // build the vao object that will render..
            const vao = this.renderer.createVao()
                .addIndex(this.indexBuffer)
                .addAttribute(vertexBuffer, attrs.aVertexPosition, gl.FLOAT, false, this.vertByteSize, 0)
                .addAttribute(vertexBuffer, attrs.aTextureCoord, gl.UNSIGNED_SHORT, true, this.vertByteSize, 2 * 4)
                .addAttribute(vertexBuffer, attrs.aColor, gl.UNSIGNED_BYTE, true, this.vertByteSize, 3 * 4);

            if (attrs.aTextureId)
            {
                vao.addAttribute(vertexBuffer, attrs.aTextureId, gl.FLOAT, false, this.vertByteSize, 4 * 4);
            }

            vao.addAttribute(vertexBuffer, attrs.aShadow, gl.FLOAT, true, this.vertByteSize, 5 * 4)
                .addAttribute(vertexBuffer, attrs.aStroke, gl.FLOAT, true, this.vertByteSize, 6 * 4)
                .addAttribute(vertexBuffer, attrs.aFill, gl.FLOAT, true, this.vertByteSize, 7 * 4)
                .addAttribute(vertexBuffer, attrs.aGamma, gl.FLOAT, true, this.vertByteSize, 8 * 4)
                .addAttribute(vertexBuffer, attrs.aShadowColor, gl.UNSIGNED_BYTE, true, this.vertByteSize, 9 * 4)
                .addAttribute(vertexBuffer, attrs.aStrokeColor, gl.UNSIGNED_BYTE, true, this.vertByteSize, 10 * 4)
                .addAttribute(vertexBuffer, attrs.aFillColor, gl.UNSIGNED_BYTE, true, this.vertByteSize, 11 * 4)
                .addAttribute(vertexBuffer, attrs.aShadowOffset, gl.FLOAT, true, this.vertByteSize, 12 * 4)
                .addAttribute(vertexBuffer, attrs.aShadowEnable, gl.FLOAT, true, this.vertByteSize, 14 * 4)
                .addAttribute(vertexBuffer, attrs.aStrokeEnable, gl.FLOAT, true, this.vertByteSize, 15 * 4)
                .addAttribute(vertexBuffer, attrs.aFillEnable, gl.FLOAT, true, this.vertByteSize, 16 * 4)
                .addAttribute(vertexBuffer, attrs.aShadowBlur, gl.FLOAT, true, this.vertByteSize, 17 * 4);

            this.vaos[i] = vao;
        }

        this.vao = this.vaos[0];
        this.currentBlendMode = 99999;

        this.boundTextures = new Array(this.MAX_TEXTURES);
    }

    /**
     * Called before the renderer starts rendering.
     *
     */
    onPrerender()
    {
        this.vertexCount = 0;
    }

    /**
     * Renders the sprite object.
     *
     * @param {PIXI.Sprite} sprite - the sprite to render when using this spritebatch
     */
    render(sprite)
    {
        // TODO set blend modes..
        // check texture..
        // if (this.currentIndex >= this.size)
        // {
        //     this.flush();
        // }

        // get the uvs for the texture

        // if the uvs have not updated then no point rendering just yet!
        // if (!sprite._texture._uvs)
        // {
        //     return;
        // }

        // push a texture.
        // increment the batchsize
        // this.sprites[this.currentIndex++] = sprite;
        // this.currentIndex--;

        if (this.currentIndex + sprite.vertexList.length < this.size) {
            this.meshes.push(...sprite.vertexList);
            this.currentIndex += sprite.vertexList.length;
        } else {

            let start = 0;
            let end = 0;
            let leftChars = sprite.vertexList.length;

            while (leftChars > 0) {
                if (leftChars > this.size - this.currentIndex - 1) {
                    start = end;
                    end += this.size - this.currentIndex - 1;
                    leftChars -= this.size - this.currentIndex - 1;
                } else {
                    start = end;
                    end += leftChars;
                    leftChars = 0;
                }
                this.meshes.push(...sprite.vertexList.slice(start, end));
                this.currentIndex += end - start;
                this.flush();
            }
        }

    }

    /**
     * Renders the content and empties the current batch.
     *
     */
    flush()
    {
        if (this.currentIndex === 0)
        {
            return;
        }

        const gl = this.renderer.gl;
        const MAX_TEXTURES = this.MAX_TEXTURES;

        const np2 = bitTwiddle.nextPow2(this.currentIndex);
        const log2 = bitTwiddle.log2(np2);
        const buffer = this.buffers[log2];

        // const sprites = this.sprites;
        const meshes = this.meshes;
        const groups = this.groups;

        const float32View = buffer.float32View;
        const uint32View = buffer.uint32View;

        const boundTextures = this.boundTextures;
        const rendererBoundTextures = this.renderer.boundTextures;
        const touch = this.renderer.textureGC.count;

        let index = 0;
        let nextTexture;
        let currentTexture;
        let groupCount = 1;
        let textureCount = 0;
        let currentGroup = groups[0];
        let vertexData;
        let uvs;
        let blendMode = meshes[0].blendMode;

        currentGroup.textureCount = 0;
        currentGroup.start = 0;
        currentGroup.blend = blendMode;

        TICK++;

        let i;

        // copy textures..
        for (i = 0; i < MAX_TEXTURES; ++i)
        {
            boundTextures[i] = rendererBoundTextures[i];
            boundTextures[i]._virtalBoundId = i;
        }

        for (i = 0; i < this.currentIndex; ++i)
        {
            // upload the sprite elemetns...
            // they have all ready been calculated so we just need to push them into the buffer.
            const mesh = meshes[i];

            nextTexture = mesh.baseTexture;

            if (blendMode !== mesh.blendMode)
            {
                // finish a group..
                blendMode = mesh.blendMode;

                // force the batch to break!
                currentTexture = null;
                textureCount = MAX_TEXTURES;
                TICK++;
            }

            if (currentTexture !== nextTexture)
            {
                currentTexture = nextTexture;

                if (nextTexture._enabled !== TICK)
                {
                    if (textureCount === MAX_TEXTURES)
                    {
                        TICK++;

                        currentGroup.size = i - currentGroup.start;

                        textureCount = 0;

                        currentGroup = groups[groupCount++];
                        currentGroup.blend = blendMode;
                        currentGroup.textureCount = 0;
                        currentGroup.start = i;
                    }

                    nextTexture.touched = touch;

                    if (nextTexture._virtalBoundId === -1)
                    {
                        for (let j = 0; j < MAX_TEXTURES; ++j)
                        {
                            const tIndex = (j + TEXTURE_TICK) % MAX_TEXTURES;

                            const t = boundTextures[tIndex];

                            if (t._enabled !== TICK)
                            {
                                TEXTURE_TICK++;

                                t._virtalBoundId = -1;

                                nextTexture._virtalBoundId = tIndex;

                                boundTextures[tIndex] = nextTexture;
                                break;
                            }
                        }
                    }

                    nextTexture._enabled = TICK;

                    currentGroup.textureCount++;
                    currentGroup.ids[textureCount] = nextTexture._virtalBoundId;
                    currentGroup.textures[textureCount++] = nextTexture;
                }
            }

            vertexData = mesh.vertexData;

            // TODO this sum does not need to be set each frame..
            uvs = mesh.uvs;

            const interval = this.vertSize;

            if (this.renderer.roundPixels)
            {
                const resolution = this.renderer.resolution;

                // xy
                float32View[index] = ((vertexData[0] * resolution) | 0) / resolution;
                float32View[index + 1] = ((vertexData[1] * resolution) | 0) / resolution;

                // xy
                float32View[index + interval * 1] = ((vertexData[2] * resolution) | 0) / resolution;
                float32View[index + 1 + interval * 1] = ((vertexData[3] * resolution) | 0) / resolution;

                // xy
                float32View[index + interval * 2] = ((vertexData[4] * resolution) | 0) / resolution;
                float32View[index + 1 + interval * 2] = ((vertexData[5] * resolution) | 0) / resolution;

                // xy
                float32View[index + interval * 3] = ((vertexData[6] * resolution) | 0) / resolution;
                float32View[index + 1 + interval * 3] = ((vertexData[7] * resolution) | 0) / resolution;
            }
            else
            {
                // xy
                float32View[index] = vertexData[0];
                float32View[index + 1] = vertexData[1];

                // xy
                float32View[index + interval * 1] = vertexData[2];
                float32View[index + 1 + interval * 1] = vertexData[3];

                // xy
                float32View[index + interval * 2] = vertexData[4];
                float32View[index + 1 + interval * 2] = vertexData[5];

                // xy
                float32View[index + interval * 3] = vertexData[6];
                float32View[index + 1 + interval * 3] = vertexData[7];
            }

            uint32View[index + 2] = uvs[0];
            uint32View[index + 2 + interval * 1] = uvs[1];
            uint32View[index + 2 + interval * 2] = uvs[2];
            uint32View[index + 2 + interval * 3] = uvs[3];

            /* eslint-disable max-len */
            uint32View[index + 3] = uint32View[index + 3 + interval * 1] = uint32View[index + 3 + interval * 2] = uint32View[index + 3 + interval * 3] = mesh.tintRGB + (Math.min(mesh.worldAlpha, 1) * 255 << 24);

            float32View[index + 4] = float32View[index + 4 + interval * 1] = float32View[index + 4 + interval * 2] = float32View[index + 4 + interval * 3] = nextTexture._virtalBoundId;

            //
            float32View[index + 5] = float32View[index + 5 + interval * 1] = float32View[index + 5 + interval * 2] = float32View[index + 5 + interval * 3] = mesh.shadow;
            float32View[index + 6] = float32View[index + 6 + interval * 1] = float32View[index + 6 + interval * 2] = float32View[index + 6 + interval * 3] = mesh.stroke;
            float32View[index + 7] = float32View[index + 7 + interval * 1] = float32View[index + 7 + interval * 2] = float32View[index + 7 + interval * 3] = mesh.fill;
            float32View[index + 8] = float32View[index + 8 + interval * 1] = float32View[index + 8 + interval * 2] = float32View[index + 8 + interval * 3] = mesh.gamma;
            uint32View[index + 9] = uint32View[index + 9 + interval * 1] = uint32View[index + 9 + interval * 2] = uint32View[index + 9 + interval * 3] = mesh.shadowColor;
            uint32View[index + 10] = uint32View[index + 10 + interval * 1] = uint32View[index + 10 + interval * 2] = uint32View[index + 10 + interval * 3] = mesh.strokeColor;
            uint32View[index + 11] = uint32View[index + 11 + interval * 1] = uint32View[index + 11 + interval * 2] = uint32View[index + 11 + interval * 3] = mesh.fillColor;
            // float32View[index + 12] = float32View[index + 12 + interval * 1] = float32View[index + 12 + interval * 2] = float32View[index + 12 + interval * 3] = mesh.strokeColor[0];
            // float32View[index + 13] = float32View[index + 13 + interval * 1] = float32View[index + 13 + interval * 2] = float32View[index + 13 + interval * 3] = mesh.strokeColor[1];
            // float32View[index + 14] = float32View[index + 14 + interval * 1] = float32View[index + 14 + interval * 2] = float32View[index + 14 + interval * 3] = mesh.strokeColor[2];
            // float32View[index + 15] = float32View[index + 15 + interval * 1] = float32View[index + 15 + interval * 2] = float32View[index + 15 + interval * 3] = mesh.fillColor[0];
            // float32View[index + 16] = float32View[index + 16 + interval * 1] = float32View[index + 16 + interval * 2] = float32View[index + 16 + interval * 3] = mesh.fillColor[1];
            // float32View[index + 17] = float32View[index + 17 + interval * 1] = float32View[index + 17 + interval * 2] = float32View[index + 17 + interval * 3] = mesh.fillColor[2];
            float32View[index + 12] = float32View[index + 12 + interval * 1] = float32View[index + 12 + interval * 2] = float32View[index + 12 + interval * 3] = mesh.shadowOffset[0];
            float32View[index + 13] = float32View[index + 13 + interval * 1] = float32View[index + 13 + interval * 2] = float32View[index + 13 + interval * 3] = mesh.shadowOffset[1];
            float32View[index + 14] = float32View[index + 14 + interval * 1] = float32View[index + 14 + interval * 2] = float32View[index + 14 + interval * 3] = mesh.shadowEnable;
            float32View[index + 15] = float32View[index + 15 + interval * 1] = float32View[index + 15 + interval * 2] = float32View[index + 15 + interval * 3] = mesh.strokeEnable;
            float32View[index + 16] = float32View[index + 16 + interval * 1] = float32View[index + 16 + interval * 2] = float32View[index + 16 + interval * 3] = mesh.fillEnable;
            float32View[index + 17] = float32View[index + 17 + interval * 1] = float32View[index + 17 + interval * 2] = float32View[index + 17 + interval * 3] = mesh.shadowBlur;
            /* eslint-enable max-len */

            // for (let i = 0; i < 16; i++) {
            //   float32View[index + 20 + i] = 0.8
            // }

            index += this.vertByteSize;
        }

        currentGroup.size = i - currentGroup.start;

        if (!settings.CAN_UPLOAD_SAME_BUFFER)
        {
            // this is still needed for IOS performance..
            // it really does not like uploading to the same buffer in a single frame!
            if (this.vaoMax <= this.vertexCount)
            {
                this.vaoMax++;

                const attrs = this.shader.attributes;

                /* eslint-disable max-len */
                const vertexBuffer = this.vertexBuffers[this.vertexCount] = glCore.GLBuffer.createVertexBuffer(gl, null, gl.STREAM_DRAW);
                /* eslint-enable max-len */

                // build the vao object that will render..
                const vao = this.renderer.createVao()
                    .addIndex(this.indexBuffer)
                    .addAttribute(vertexBuffer, attrs.aVertexPosition, gl.FLOAT, false, this.vertByteSize, 0)
                    .addAttribute(vertexBuffer, attrs.aTextureCoord, gl.UNSIGNED_SHORT, true, this.vertByteSize, 2 * 4)
                    .addAttribute(vertexBuffer, attrs.aColor, gl.UNSIGNED_BYTE, true, this.vertByteSize, 3 * 4);

                if (attrs.aTextureId)
                {
                    vao.addAttribute(vertexBuffer, attrs.aTextureId, gl.FLOAT, false, this.vertByteSize, 4 * 4);
                }

                vao.addAttribute(vertexBuffer, attrs.aShadow, gl.FLOAT, true, this.vertByteSize, 5 * 4)
                    .addAttribute(vertexBuffer, attrs.aStroke, gl.FLOAT, true, this.vertByteSize, 6 * 4)
                    .addAttribute(vertexBuffer, attrs.aFill, gl.FLOAT, true, this.vertByteSize, 7 * 4)
                    .addAttribute(vertexBuffer, attrs.aGamma, gl.FLOAT, true, this.vertByteSize, 8 * 4)
                    .addAttribute(vertexBuffer, attrs.aShadowColor, gl.UNSIGNED_BYTE, true, this.vertByteSize, 9 * 4)
                    .addAttribute(vertexBuffer, attrs.aStrokeColor, gl.UNSIGNED_BYTE, true, this.vertByteSize, 10 * 4)
                    .addAttribute(vertexBuffer, attrs.aFillColor, gl.UNSIGNED_BYTE, true, this.vertByteSize, 11 * 4)
                    .addAttribute(vertexBuffer, attrs.aShadowOffset, gl.FLOAT, true, this.vertByteSize, 12 * 4)
                    .addAttribute(vertexBuffer, attrs.aShadowEnable, gl.FLOAT, true, this.vertByteSize, 14 * 4)
                    .addAttribute(vertexBuffer, attrs.aStrokeEnable, gl.FLOAT, true, this.vertByteSize, 15 * 4)
                    .addAttribute(vertexBuffer, attrs.aFillEnable, gl.FLOAT, true, this.vertByteSize, 16 * 4)
                    .addAttribute(vertexBuffer, attrs.aShadowBlur, gl.FLOAT, true, this.vertByteSize, 17 * 4);

                this.vaos[this.vertexCount] = vao;
            }

            this.renderer.bindVao(this.vaos[this.vertexCount]);

            this.vertexBuffers[this.vertexCount].upload(buffer.vertices, 0, false);

            this.vertexCount++;
        }
        else
        {
            // lets use the faster option, always use buffer number 0
            this.vertexBuffers[this.vertexCount].upload(buffer.vertices, 0, true);
        }

        for (i = 0; i < MAX_TEXTURES; ++i)
        {
            rendererBoundTextures[i]._virtalBoundId = -1;
        }

        // render the groups..
        for (i = 0; i < groupCount; ++i)
        {
            const group = groups[i];
            const groupTextureCount = group.textureCount;

            for (let j = 0; j < groupTextureCount; j++)
            {
                currentTexture = group.textures[j];

                // reset virtual ids..
                // lets do a quick check..
                if (rendererBoundTextures[group.ids[j]] !== currentTexture)
                {
                    this.renderer.bindTexture(currentTexture, group.ids[j], true);
                }

                // reset the virtualId..
                currentTexture._virtalBoundId = -1;
            }

            // set the blend mode..
            this.renderer.state.setBlendMode(group.blend);

            gl.drawElements(gl.TRIANGLES, group.size * 6, gl.UNSIGNED_SHORT, group.start * 6 * 2);
        }

        // reset elements for the next flush
        this.currentIndex = 0;
        this.meshes = [];
    }

    /**
     * Starts a new sprite batch.
     */
    start()
    {
        this.renderer.bindShader(this.shader);

        if (settings.CAN_UPLOAD_SAME_BUFFER)
        {
            // bind buffer #0, we don't need others
            this.renderer.bindVao(this.vaos[this.vertexCount]);

            this.vertexBuffers[this.vertexCount].bind();
        }
    }

    /**
     * Stops and flushes the current batch.
     *
     */
    stop()
    {
        this.flush();
    }

    /**
     * Destroys the SpriteRenderer.
     *
     */
    destroy()
    {
        for (let i = 0; i < this.vaoMax; i++)
        {
            if (this.vertexBuffers[i])
            {
                this.vertexBuffers[i].destroy();
            }
            if (this.vaos[i])
            {
                this.vaos[i].destroy();
            }
        }

        if (this.indexBuffer)
        {
            this.indexBuffer.destroy();
        }

        this.renderer.off('prerender', this.onPrerender, this);

        super.destroy();

        if (this.shader)
        {
            this.shader.destroy();
            this.shader = null;
        }

        this.vertexBuffers = null;
        this.vaos = null;
        this.indexBuffer = null;
        this.indices = null;

        // this.sprites = null;

        this.meshes = null;

        for (let i = 0; i < this.buffers.length; ++i)
        {
            this.buffers[i].destroy();
        }
    }
}

WebGLRenderer.registerPlugin('richtext', RichTextRenderer);