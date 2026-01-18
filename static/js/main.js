// AI OCR Application JavaScript
// Main functionality for the OCR web application

let currentImages = [];
let isRecognizing = false;
let abortController = null;
let sessionHistory = [];
let scale = 1, posX = 0, posY = 0, isDragging = false, startX, startY;
let reasoningContent = ''; // Store reasoning content

// Application configuration (will be populated from server)
let APP_CONFIG = {
    apiKey: '',
    defaultModel: '',
    enableReasoningByDefault: true, // boolean: true or false
    systemPrompt: ''
};

// Initialize application when page loads
window.onload = async () => {
    // Load configuration from server
    await loadConfig();

    const listContainer = document.getElementById('image-list-container');
    Sortable.create(listContainer, {
        animation: 250,
        ghostClass: 'sortable-ghost',
        onEnd: () => {
            const ids = Array.from(listContainer.querySelectorAll('.img-item')).map(item => item.dataset.id);
            currentImages = ids.map(id => currentImages.find(img => img.id == id));
        }
    });

    listContainer.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) { e.preventDefault(); listContainer.scrollLeft += e.deltaY; }
    });

    document.addEventListener('paste', handlePaste);
    document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeImagePreview(); });
    setupImageInteractions();

    // Load history from server
    await loadHistory();
};

// Load configuration from server
async function loadConfig() {
    try {
        const response = await fetch('/api/models');
        if (response.ok) {
            const data = await response.json();
            APP_CONFIG.models = data.models;
            APP_CONFIG.defaultModel = data.default_model;
            APP_CONFIG.enableReasoningByDefault = data.enable_reasoning_by_default !== undefined ? data.enable_reasoning_by_default : true;

            // Set default model in select if not already set
            const modelSelect = document.getElementById('model-select');
            if (modelSelect && !modelSelect.value) {
                modelSelect.value = APP_CONFIG.defaultModel;
            }

            // Add event listener for model selection change
            modelSelect.addEventListener('change', updateReasoningToggleState);

            // Add event listener for reasoning toggle change
            const reasoningToggle = document.getElementById('reasoning-toggle');
            if (reasoningToggle) {
                reasoningToggle.addEventListener('change', updateReasoningToggleState);
            }

            // Initial update of reasoning toggle state
            updateReasoningToggleState();
        }
    } catch (error) {
        console.error('Failed to load configuration:', error);
    }
}

// Update reasoning toggle state based on selected model and config
function updateReasoningToggleState() {
    const modelSelect = document.getElementById('model-select');
    const reasoningToggle = document.getElementById('reasoning-toggle');
    const selectedModelId = modelSelect.value;

    // Find the selected model
    const selectedModel = APP_CONFIG.models?.find(model => model.id === selectedModelId);
    if (!selectedModel) return;

    // Get model's supports_reasoning value (string: 'default', 'true', or 'false')
    const supportsReasoning = selectedModel.supports_reasoning;
    const toggleContainer = reasoningToggle.parentElement.parentElement;

    switch (supportsReasoning) {
        case 'false':
            // Model does not support reasoning: disable toggle and uncheck it
            reasoningToggle.disabled = true;
            reasoningToggle.checked = false;
            reasoningToggle.parentElement.style.opacity = '0.5';
            toggleContainer.classList.add('disabled');
            toggleContainer.style.cursor = 'not-allowed';
            break;
        case 'default':
            // Default reasoning always on and cannot be changed
            reasoningToggle.disabled = true;
            reasoningToggle.checked = true;
            reasoningToggle.parentElement.style.opacity = '0.7';
            toggleContainer.classList.add('disabled');
            toggleContainer.style.cursor = 'not-allowed';
            break;
        case 'true':
            // Model supports reasoning, user can freely toggle (like before)
            reasoningToggle.disabled = false;
            reasoningToggle.parentElement.style.opacity = '1';
            toggleContainer.classList.remove('disabled');
            toggleContainer.style.cursor = 'pointer';
            // Note: checked state is already set by template, user can change it freely
            break;
        default:
            // Fallback: treat as 'false' for unknown values
            reasoningToggle.disabled = true;
            reasoningToggle.checked = false;
            reasoningToggle.parentElement.style.opacity = '0.5';
            toggleContainer.classList.add('disabled');
            toggleContainer.style.cursor = 'not-allowed';
    }
}

// Load history from server
async function loadHistory() {
    try {
        const response = await fetch('/api/history');
        if (response.ok) {
            const data = await response.json();
            sessionHistory = data.history || [];
        }
    } catch (error) {
        console.error('Failed to load history:', error);
        sessionHistory = [];
    }
}

// Image interaction setup
function setupImageInteractions() {
    const previewImg = document.getElementById('preview-image');
    previewImg.addEventListener('mousedown', (e) => {
        e.preventDefault(); isDragging = true;
        startX = e.clientX - posX; startY = e.clientY - posY;
    });
    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        posX = e.clientX - startX; posY = e.clientY - startY;
        updateTransform();
    });
    window.addEventListener('mouseup', () => { isDragging = false; });
    previewImg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.8 : 1.2;
        const nextScale = Math.min(Math.max(0.5, scale * delta), 15);
        const rect = previewImg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const ratio = nextScale / scale;
        posX -= (mouseX - rect.width / 2) * (ratio - 1);
        posY -= (mouseY - rect.height / 2) * (ratio - 1);
        scale = nextScale;
        updateTransform();
    }, { passive: false });
}

function updateTransform() {
    document.getElementById('preview-image').style.transform = `translate(${posX}px, ${posY}px) scale(${scale})`;
}

function handlePreviewOverlayClick(e) {
    if (e.target.classList.contains('viewport') || e.target.id === 'image-preview-modal') closeImagePreview();
}

// File handling functions
function processFiles(files) {
    Array.from(files).forEach(file => {
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            currentImages.push({ id: Date.now() + Math.random(), name: file.name, base64: e.target.result });
            renderImages();
        };
        reader.readAsDataURL(file);
    });
}

function renderImages() {
    const container = document.getElementById('image-list-container');
    if (currentImages.length === 0) {
        container.innerHTML = '<div id="drop-hint" style="color: var(--text-muted); text-align: center; width: 100%;">Drop images or paste</div>';
        return;
    }
    container.innerHTML = currentImages.map(img => `
        <div class="img-item" data-id="${img.id}" onclick="showImageModal('${img.base64}')">
            <img src="${img.base64}" class="img-thumb">
            <span class="img-name">${img.name}</span>
            <button class="img-delete" onclick="event.stopPropagation(); removeImage(${img.id})">×</button>
        </div>
    `).join('');
}

function removeImage(id) {
    currentImages = currentImages.filter(img => img.id !== id);
    renderImages();
}

function clearInput() {
    if(confirm("Clear input images and prompt?")) {
        currentImages = [];
        renderImages();
        document.getElementById('user-prompt').value = "";
        // Do not clear result display, reasoning content, or change box expansion state
    }
}

function showImageModal(base64) {
    const modal = document.getElementById('image-preview-modal');
    const img = document.getElementById('preview-image');
    img.src = base64;
    modal.style.display = 'block';
    scale = 1; posX = 0; posY = 0;
    img.style.transform = `translate(0,0) scale(1)`;
}

function closeImagePreview() {
    document.getElementById('image-preview-modal').style.display = 'none';
    isDragging = false;
}

// Main OCR recognition function
async function toggleRecognize() {
    if (isRecognizing) { abortController?.abort(); return; }
    if (currentImages.length === 0) return alert("Please add images.");

    isRecognizing = true;
    const btn = document.getElementById('btn-recognize');
    const display = document.getElementById('result-display');
    const reasoningDisplay = document.getElementById('reasoning-display');
    btn.innerText = "Stop";
    btn.classList.add('btn-stop');

    // Update status: connecting
    updateStatus("Connecting...", 'connecting');

    // Clear previous results
    display.innerText = "";
    reasoningContent = '';
    reasoningDisplay.innerText = '';

    // Clear previous status indicators
    const reasoningStatus = document.getElementById('reasoning-status');
    const outputStatus = document.getElementById('output-status');
    reasoningStatus.className = 'box-status';
    outputStatus.className = 'box-status';

    abortController = new AbortController();
    let fullText = "";
    let reasoningText = "";
    const reasoningEnabled = document.getElementById('reasoning-toggle').checked;

    try {
        // Prepare request data
        const requestData = {
            images: currentImages.map(img => img.base64),
            prompt: document.getElementById('user-prompt').value || '',
            model: document.getElementById('model-select').value,
            enable_reasoning: document.getElementById('reasoning-toggle').checked
        };

        // Set box states based on actual request (enable_reasoning)
        const reasoningBox = document.getElementById('reasoning-box');
        const outputBox = document.getElementById('output-box');

        if (reasoningEnabled) {
            // Show reasoning box and set initial state: reasoning expanded, output collapsed
            reasoningBox.style.display = 'flex';
            reasoningBox.classList.remove('collapsed');
            reasoningBox.classList.add('expanded');
            document.getElementById('reasoning-toggle-icon').textContent = '▲';

            outputBox.classList.remove('expanded');
            outputBox.classList.add('collapsed');
            document.getElementById('output-toggle-icon').textContent = '▼';

            // Clear any spinning status from output status
            outputStatus.className = 'box-status';
            // Set reasoning status to spinning
            reasoningStatus.className = 'box-status spinning';
        } else {
            // Hide reasoning box and expand output box
            reasoningBox.style.display = 'none';
            reasoningBox.classList.remove('expanded');
            reasoningBox.classList.add('collapsed');
            document.getElementById('reasoning-toggle-icon').textContent = '▼';

            outputBox.classList.remove('collapsed');
            outputBox.classList.add('expanded');
            document.getElementById('output-toggle-icon').textContent = '▲';

            // Clear any spinning status from reasoning status
            reasoningStatus.className = 'box-status';
            // Set output status to spinning
            outputStatus.className = 'box-status spinning';
        }

        // Update status: processing (after connecting)
        updateStatus("Processing...", 'processing');

        // Use streaming endpoint
        const response = await fetch('/api/stream_recognize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData),
            signal: abortController.signal
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        // Handle streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop(); // Keep last incomplete line

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === "data: [DONE]") continue;

                if (trimmed.startsWith("data: ")) {
                    try {
                        const json = JSON.parse(trimmed.slice(6));

                        // Check for OpenRouter reasoning format (type: 'response.reasoning.delta')
                        if (json.type === 'response.reasoning.delta') {
                            const reasoningDelta = json.delta || "";
                            if (reasoningDelta) {
                                reasoningText += reasoningDelta;
                                showReasoningContent(reasoningText);
                            }
                        }
                        // Check for standard OpenAI format with reasoning
                        else if (json.choices && json.choices[0]?.delta) {
                            const delta = json.choices[0].delta;
                            const content = delta.content || "";
                            const reasoning = delta.reasoning || "";

                            // Handle reasoning content
                            if (reasoning) {
                                reasoningText += reasoning;
                                showReasoningContent(reasoningText);
                            }

                            // Handle regular output content
                            if (content) {
                                fullText += content;
                                display.innerText = fullText;
                                display.scrollTo({ top: display.scrollHeight, behavior: 'smooth' });
                            }
                        }
                    } catch (e) {
                        console.error("Parse error", e);
                    }
                }
            }
        }

        // Process final text (remove markers if present)
        const BEGIN_MARKER = "<|begin_of_box|>";
        const END_MARKER = "<|end_of_box|>";
        if (fullText.startsWith(BEGIN_MARKER) && fullText.endsWith(END_MARKER)) {
            fullText = fullText.substring(BEGIN_MARKER.length, fullText.length - END_MARKER.length);
            display.innerText = fullText;
            display.scrollTo({ top: display.scrollHeight, behavior: 'smooth' });
        }

        if (fullText) {
            // Add to local history
            sessionHistory.unshift({
                id: Date.now(),
                time: new Date().toLocaleTimeString(),
                text: fullText
            });

            updateStatus("Done", 'success');

            // Update box status indicators to completed
            const reasoningStatus = document.getElementById('reasoning-status');
            const outputStatus = document.getElementById('output-status');
            if (reasoningEnabled && reasoningText) {
                reasoningStatus.className = 'box-status completed';
                // Output is also completed since stream has ended
                outputStatus.className = 'box-status completed';
            } else {
                // If reasoning not enabled, output was spinning, now mark as completed
                outputStatus.className = 'box-status completed';
            }

            // Auto-switch boxes after final output: collapse reasoning, expand output
            if (reasoningText) {
                setTimeout(() => {
                    const reasoningBox = document.getElementById('reasoning-box');
                    const outputBox = document.getElementById('output-box');

                    // Only switch if reasoning box is visible
                    if (reasoningBox.style.display !== 'none') {
                        // Collapse reasoning box and expand output box (mutually exclusive)
                        reasoningBox.classList.remove('expanded');
                        reasoningBox.classList.add('collapsed');
                        document.getElementById('reasoning-toggle-icon').textContent = '▼';

                        outputBox.classList.remove('collapsed');
                        outputBox.classList.add('expanded');
                        document.getElementById('output-toggle-icon').textContent = '▲';

                        // Output already marked as completed
                    }
                }, 1000);
            }
        }

    } catch (err) {
        if (err.name === 'AbortError') {
            updateStatus("Stopped", 'error');
            // Clear spinning status indicators when user stops
            reasoningStatus.className = 'box-status';
            outputStatus.className = 'box-status';
        } else {
            updateStatus("Error: " + err.message, 'error');
            console.error(err);
            // Set error status indicators
            reasoningStatus.className = 'box-status error';
            outputStatus.className = 'box-status error';
        }
    } finally {
        isRecognizing = false;
        btn.innerText = "Start";
        btn.classList.remove('btn-stop');
    }
}

// Reasoning content display functions
function showReasoningContent(content) {
    reasoningContent = content;
    const reasoningDisplay = document.getElementById('reasoning-display');
    const reasoningBox = document.getElementById('reasoning-box');
    const outputBox = document.getElementById('output-box');

    if (content && content.trim()) {
        reasoningDisplay.innerText = content;
        // Ensure reasoning box is visible
        reasoningBox.style.display = 'flex';

        // Expand reasoning box and collapse output box (mutually exclusive)
        reasoningBox.classList.remove('collapsed');
        reasoningBox.classList.add('expanded');
        document.getElementById('reasoning-toggle-icon').textContent = '▲';

        outputBox.classList.remove('expanded');
        outputBox.classList.add('collapsed');
        document.getElementById('output-toggle-icon').textContent = '▼';

        // Ensure reasoning status shows spinning, output status does not
        const reasoningStatus = document.getElementById('reasoning-status');
        const outputStatus = document.getElementById('output-status');
        outputStatus.className = 'box-status';
        reasoningStatus.className = 'box-status spinning';
    } else {
        hideReasoningContent();
    }
}

function hideReasoningContent() {
    const reasoningBox = document.getElementById('reasoning-box');
    const outputBox = document.getElementById('output-box');
    // Collapse reasoning box and expand output box (mutually exclusive)
    if (!reasoningBox.classList.contains('collapsed')) {
        reasoningBox.classList.remove('expanded');
        reasoningBox.classList.add('collapsed');
        document.getElementById('reasoning-toggle-icon').textContent = '▼';

        outputBox.classList.remove('collapsed');
        outputBox.classList.add('expanded');
        document.getElementById('output-toggle-icon').textContent = '▲';
    }
}

function toggleBox(boxType) {
    const reasoningBox = document.getElementById('reasoning-box');
    const outputBox = document.getElementById('output-box');
    const reasoningToggleIcon = document.getElementById('reasoning-toggle-icon');
    const outputToggleIcon = document.getElementById('output-toggle-icon');

    const targetBox = boxType === 'reasoning' ? reasoningBox : outputBox;
    const otherBox = boxType === 'reasoning' ? outputBox : reasoningBox;
    const targetToggleIcon = boxType === 'reasoning' ? reasoningToggleIcon : outputToggleIcon;
    const otherToggleIcon = boxType === 'reasoning' ? outputToggleIcon : reasoningToggleIcon;

    // Toggle the target box
    if (targetBox.classList.contains('collapsed')) {
        // Expand target box, collapse other box
        targetBox.classList.remove('collapsed');
        targetBox.classList.add('expanded');
        targetToggleIcon.textContent = '▲';

        otherBox.classList.remove('expanded');
        otherBox.classList.add('collapsed');
        otherToggleIcon.textContent = '▼';
    } else {
        // Target box is expanded, collapse it and expand other box
        targetBox.classList.remove('expanded');
        targetBox.classList.add('collapsed');
        targetToggleIcon.textContent = '▼';

        otherBox.classList.remove('collapsed');
        otherBox.classList.add('expanded');
        otherToggleIcon.textContent = '▲';
    }
}

// Legacy function for backward compatibility
function toggleReasoningDisplay() {
    toggleBox('reasoning');
}

function updateStatus(msg, type) {
    const s = document.getElementById('status-indicator');
    s.innerText = msg;
    s.className = type;
}

function copyResult() {
    const text = document.getElementById('result-display').innerText;
    if(text) copyToClipboard(text);
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        const currentMsg = document.getElementById('status-indicator').innerText;
        const currentClass = document.getElementById('status-indicator').className;
        updateStatus("Copied!", 'success');
        setTimeout(() => updateStatus(currentMsg, currentClass), 1500);
    });
}

function openHistory() {
    const list = document.getElementById('history-list');
    list.innerHTML = sessionHistory.map((h, index) => `
        <div class="history-item">
            <div class="history-content">
                <span class="history-time">${h.time}</span>
                <div class="history-preview">${h.text.substring(0, 60).replace(/[\n\r]/g, ' ')}...</div>
            </div>
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;"
                    onclick="copyHistoryItem(${index})">Copy</button>
        </div>
    `).join('') || '<div style="text-align:center; padding:20px; color:var(--text-muted);">No records.</div>';
    document.getElementById('history-modal').style.display = 'block';
}

function copyHistoryItem(index) {
    if(sessionHistory[index]) copyToClipboard(sessionHistory[index].text);
}

function closeModal() { document.getElementById('history-modal').style.display = 'none'; }
function dragOverHandler(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function dragLeaveHandler(e) { e.currentTarget.classList.remove('drag-over'); }
function dropHandler(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    processFiles(e.dataTransfer.files);
}
function handlePaste(e) {
    const items = e.clipboardData.items;
    for (let item of items) { if (item.type.indexOf("image") !== -1) processFiles([item.getAsFile()]); }
}