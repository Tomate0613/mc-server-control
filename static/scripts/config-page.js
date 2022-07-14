document.addEventListener('DOMContentLoaded', () => {
    const id = document.getElementById('box').dataset.id;

    const request = new XMLHttpRequest();
    request.open('GET', `/api/servers/${id}/config/properties`);
    request.send();

    request.addEventListener('load', function() {
        const response = JSON.parse(this.responseText);
        const properties = response.properties;

        let keys = Object.keys(properties);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const property = properties[key];

            if (property === 'false' || property === 'true') {
                const div = document.createElement('div');
                div.classList.add('property');
                div.classList.add('bool');
                //div.innerHTML = `<label id="${key}" class="key" for="${key}-value">${key}</label>: <input id="${key}-value" class="value" type="checkbox" ${property === 'true' ? 'checked':''}>`;
                div.innerHTML = `
                <div class="toggle">
                    <label for = "checkbox">
                        ${key}
                        <div class="slider">
                            <div class="handle"></div>
                        </div>
                    </label>
                    <input type="checkbox" id="${key}-value">
                </div>`;

                document.getElementById('properties').appendChild(div);
                const checkbox = document.getElementById(`${key}-value`);
                checkbox.checked = property === 'true';
                updateToggle(checkbox);

                div.addEventListener('click', () => {
                    const value = !checkbox.checked;
                    const req = setProperty(key, value, id);
                    req.addEventListener('load', () => {
                        const status = JSON.parse(req.responseText).status;
                        console.log(status);
                        if (status === 'OK') {
                            checkbox.checked = value;
                            updateToggle(checkbox);
                        } else {
                            console.log(response);
                        }
                    });
                });
            } else if (!isNaN(property, 10)) {
                const div = document.createElement('div');
                div.classList.add('property');
                div.classList.add('int');
                div.innerHTML = `<label id="${key}" class="key" for="${key}-value">${key}</label>: <input id="${key}-value" class="value" type="number" value="${property}">`;

                document.getElementById('properties').appendChild(div);
                let value = document.getElementById(`${key}-value`).value;

                div.addEventListener('click', () => {
                    let newValue = document.getElementById(`${key}-value`).value;
                    const req = setProperty(key, newValue, id);
                    req.addEventListener('load', () => {
                        const status = JSON.parse(req.responseText).status;
                        if (status !== 'OK') {
                            document.getElementById(`${key}-value`).value = value;
                        }
                    });
                });
            } else {
                const div = document.createElement('div');
                div.classList.add('property');
                div.classList.add('text');
                div.innerHTML = `<span id="${key}" class="key">${key}</span>: <span id="${key}-value" class="value">${property}</span>`;

                div.addEventListener('click', () => {
                    createModal('Options', `
                        <form>
                            <div class="form-group">
                                <label for="value">${key}: </label><input type="text" name="value" id="value"value="${document.getElementById(`${key}-value`).innerText}">
                            </div>
                            <div class="form-group">
                                <input type="submit" class="btn" value="OK">
                            </div>
                         </form>
                    `).addEventListener('submit', () => {
                        event.preventDefault();
                        const newValue = document.getElementById('value').value;

                        const req = setProperty(key, newValue, id);

                        req.addEventListener('load', function() {
                            const status = JSON.parse(req.responseText).status;

                            if (status === 'OK') {
                                document.getElementById('background').remove();
                                document.getElementById(`${key}-value`).innerText = newValue;
                            } else {
                                console.error(req.response);
                            }
                        });
                    });
                });

                document.getElementById('properties').appendChild(div);
            }
        }
    });
});

function updateToggle(checkbox) {
    const toggle = checkbox.parentElement;

    if (checkbox.checked)
        toggle.classList.add('on');
    else
        toggle.classList.remove('on');
}

function setProperty(key, value, id) {
    const request = new XMLHttpRequest();
    const body = { key, value };

    request.open('POST', `/api/server/${id}/change/property`);
    request.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');

    request.send(JSON.stringify(body));

    return request;
}