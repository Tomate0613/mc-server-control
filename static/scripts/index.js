function createModal(title, body, force = false){
    const modal = document.createElement('div');

    modal.classList.add('modal');
    modal.classList.add('fade');
    modal.id = 'add-server-modal';
    modal.tabIndex = -1;
    modal.ariaRoleDescription = 'dialog';

    modal.innerHTML = `
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">${title}</h5>
                    ${ force?'':`
                    <button id="close-add-server-modal" type="button" onclick="document.getElementById('background').remove()" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true" class="iconify" data-icon="mdi-close">&times;</span>
                    </button>`
                    }
                </div>
                <div class="modal-body">
                    ${body}
                </div>
            </div>
        </div>
    `;

    const background = document.createElement('div');
    background.classList.add('background');
    background.id = 'background';

    background.append(modal);
    document.body.append(background);
    return modal;
}