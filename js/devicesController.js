function DevicesController(optionsController, timeFilterController) {
    this.device_MARKER_VIEW_SIZE = 30;
    this.optionsController = optionsController;
    this.timeFilterController = timeFilterController;

    this.mainLayer = null;
    // indexed by device id
    // those actually added to map, those which get toggled
    this.mapDeviceLayers = {};
    // layers which contain lines/markers
    this.deviceLineLayers = {};
    this.deviceMarkerLayers = {};
    this.devices = {};

    this.firstDate = null;
    this.lastDate = null;

    // used by optionsController to know if devices loading
    // was done before or after option restoration
    this.deviceListLoaded = false;

    this.changingColorOf = null;
    this.deviceDeletionTimer = {};
    this.sendPositionTimer = null;
    this.currentPrecisionCircle = null;
    this.lastZIndex = 1000;
    this.lineMarker = null;
}

DevicesController.prototype = {

    initController : function(map) {
        this.map = map;
        this.mainLayer = L.featureGroup();
        var that = this;
        // click on menu buttons
        $('body').on('click', '.devicesMenuButton, .deviceMenuButton', function(e) {
            var wasOpen = $(this).parent().parent().parent().find('>.app-navigation-entry-menu').hasClass('open');
            $('.app-navigation-entry-menu.open').removeClass('open');
            if (!wasOpen) {
                $(this).parent().parent().parent().find('>.app-navigation-entry-menu').addClass('open');
            }
        });
        // toggle a device
        $('body').on('click', '.device-line .device-name', function(e) {
            var id = $(this).parent().attr('device');
            that.toggleDevice(id, true);
        });
        // click on a device name : zoom to bounds
        $('body').on('click', '.zoomDeviceButton', function(e) {
            var id = $(this).parent().parent().parent().parent().attr('device');
            that.zoomOnDevice(id);
        });
        // toggle a device line
        $('body').on('click', '.toggleDeviceLine', function(e) {
            var id = $(this).parent().parent().parent().parent().attr('device');
            that.toggleDeviceLine(id, true);
        });
        $('body').on('click', '.contextToggleLine', function(e) {
            var id = $(this).parent().parent().attr('devid');
            that.toggleDeviceLine(id, true);
            that.map.closePopup();
        });
        // toggle devices
        $('body').on('click', '#navigation-devices > a', function(e) {
            that.toggleDevices();
            that.optionsController.saveOptionValues({devicesEnabled: that.map.hasLayer(that.mainLayer)});
            that.updateMyFirstLastDates(true);
            if (that.map.hasLayer(that.mainLayer) && !$('#navigation-devices').hasClass('open')) {
                that.toggleDeviceList();
                that.optionsController.saveOptionValues({deviceListShow: $('#navigation-devices').hasClass('open')});
            }
        });
        // expand device list
        $('body').on('click', '#navigation-devices', function(e) {
            if (e.target.tagName === 'LI' && $(e.target).attr('id') === 'navigation-devices') {
                that.toggleDeviceList();
                that.optionsController.saveOptionValues({deviceListShow: $('#navigation-devices').hasClass('open')});
            }
        });
        // color management
        $('body').on('click', '.changeDeviceColor', function(e) {
            var id = $(this).parent().parent().parent().parent().attr('device');
            that.askChangeDeviceColor(id);
        });
        $('body').on('click', '.contextChangeDeviceColor', function(e) {
            var id = $(this).parent().parent().attr('devid');
            that.askChangeDeviceColor(id);
            that.map.closePopup();
        });
        $('body').on('change', '#devicecolorinput', function(e) {
            that.okColor();
        });
        // delete a device
        $('body').on('click', '.deleteDevice', function(e) {
            var devid = $(this).parent().parent().parent().parent().attr('device');
            $(this).parent().parent().parent().parent().addClass('deleted');
            that.deviceDeletionTimer[devid] = new Timer(function() {
                that.deleteDeviceDB(devid);
            }, 7000);
        });
        $('body').on('click', '.undoDeleteDevice', function(e) {
            var devid = $(this).parent().parent().attr('device');
            $(this).parent().parent().removeClass('deleted');
            that.deviceDeletionTimer[devid].pause();
            delete that.deviceDeletionTimer[devid];
        });
        // show/hide all device
        $('body').on('click', '#select-all-devices', function(e) {
            that.showAllDevices();
            var deviceList = Object.keys(that.mapDeviceLayers);
            var deviceStringList = deviceList.join('|');
            that.optionsController.saveOptionValues({enabledDevices: deviceStringList});
            that.optionsController.enabledDevices = deviceList;
            that.optionsController.saveOptionValues({devicesEnabled: that.map.hasLayer(that.mainLayer)});
        });
        $('body').on('click', '#select-no-devices', function(e) {
            that.hideAllDevices();
            var deviceStringList = '';
            that.optionsController.saveOptionValues({enabledDevices: deviceStringList});
            that.optionsController.enabledDevices = [];
            that.optionsController.saveOptionValues({devicesEnabled: that.map.hasLayer(that.mainLayer)});
        });
        // refresh devices positions
        $('body').on('click', '#refresh-all-devices', function(e) {
            that.refreshAllDevices();
        });
        $('body').on('click', '#track-me', function(e) {
            if ($(this).is(':checked')) {
                that.launchTrackLoop();
                that.optionsController.saveOptionValues({trackMe: true});
            }
            else {
                that.stopTrackLoop();
                that.optionsController.saveOptionValues({trackMe: false});
            }
        });

        this.map.on('click', function (e) {
            if (that.lineMarker) {
                that.lineMarker.remove();
                that.lineMarker = null;
            }
        });
    },

    // expand or fold device list in sidebar
    toggleDeviceList: function() {
        $('#navigation-devices').toggleClass('open');
    },

    // toggle devices general layer on map and save state in user options
    toggleDevices: function() {
        if (this.map.hasLayer(this.mainLayer)) {
            this.map.removeLayer(this.mainLayer);
            // color of the eye
            $('#navigation-devices').removeClass('active');
            $('#map').focus();
            // remove potential line marker
            if (this.lineMarker) {
                this.lineMarker.remove();
                this.lineMarker = null;
            }
        }
        else {
            if (!this.deviceListLoaded) {
                this.getDevices();
            }
            this.map.addLayer(this.mainLayer);
            $('#navigation-devices').addClass('active');
        }
    },

    showAllDevices: function() {
        if (!this.map.hasLayer(this.mainLayer)) {
            this.toggleDevices();
        }
        for (var id in this.mapDeviceLayers) {
            if (!this.mainLayer.hasLayer(this.mapDeviceLayers[id])) {
                this.toggleDevice(id);
            }
        }
        this.updateMyFirstLastDates(true);
    },

    hideAllDevices: function() {
        for (var id in this.mapDeviceLayers) {
            if (this.mainLayer.hasLayer(this.mapDeviceLayers[id])) {
                this.toggleDevice(id);
            }
        }
        this.updateMyFirstLastDates(true);
    },

    getDevices: function(show=false) {
        var that = this;
        $('#navigation-devices').addClass('icon-loading-small');
        var req = {};
        var url = OC.generateUrl('/apps/maps/devices');
        $.ajax({
            type: 'GET',
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            var i, device;
            for (i=0; i < response.length; i++) {
                device = response[i];
                if (!that.devices.hasOwnProperty(device.id)) {
                    that.addDeviceMap(device, show, true);
                }
            }
            that.deviceListLoaded = true;
        }).always(function (response) {
            $('#navigation-devices').removeClass('icon-loading-small');
        }).fail(function() {
            OC.Notification.showTemporary(t('maps', 'Failed to load device list'));
        });
    },

    addDeviceMap: function(device, show=false, pageLoad=false) {
        var id = device.id;
        // color
        var color = device.color || OCA.Theming.color;
        this.devices[id] = device;
        this.devices[id].color = color;
        this.devices[id].info = getDeviceInfoFromUserAgent(device.user_agent);

        this.devices[id].icon = L.divIcon(L.extend({
            html: '<div class="thumbnail"></div>​',
            className: 'leaflet-marker-device device-marker device-marker-'+id
        }, null, {
            iconSize: [this.device_MARKER_VIEW_SIZE, this.device_MARKER_VIEW_SIZE],
            iconAnchor:   [this.device_MARKER_VIEW_SIZE / 2, this.device_MARKER_VIEW_SIZE]
        }));
        var radius = 8;
        this.devices[id].overicon = L.divIcon({
            iconAnchor: [radius, radius],
            className: 'device-over-marker device-over-marker-' + id,
            html: ''
        });
        this.setDeviceCss(id, color);

        this.mapDeviceLayers[id] = L.featureGroup();
        this.deviceLineLayers[id] = L.featureGroup();
        this.deviceMarkerLayers[id] = L.featureGroup();
        this.devices[id].loaded = false;
        this.mapDeviceLayers[id].addLayer(this.deviceLineLayers[id]);
        this.mapDeviceLayers[id].addLayer(this.deviceMarkerLayers[id]);

        var name = device.user_agent;
        if (device.info.os) {
            name = device.info.os;
            if (device.info.client) {
                name = name + ' ' + device.info.client;
                if (device.info.clientVersion) {
                    name = name + '(' + device.info.clientVersion + ')';
                }
            }
        }
        device.name = name;

        // side menu entry
        var imgurl;
        if (['Windows', 'GNU/Linux', 'MacOS'].indexOf(device.info.os) !== -1) {
            imgurl = OC.generateUrl('/svg/core/clients/desktop?color='+color.replace('#', ''));
        }
        else {
            imgurl = OC.generateUrl('/svg/core/clients/phone?color='+color.replace('#', ''));
        }
        var li = '<li class="device-line" id="'+name+'-device" device="'+id+'" name="'+name+'">' +
        '    <a href="#" class="device-name" id="'+name+'-device-name" title="'+name+'" style="background-image: url('+imgurl+')">'+name+'</a>' +
        '    <div class="app-navigation-entry-utils">' +
        '        <ul>' +
        '            <li class="app-navigation-entry-utils-menu-button deviceMenuButton">' +
        '                <button></button>' +
        '            </li>' +
        '        </ul>' +
        '    </div>' +
        '    <div class="app-navigation-entry-menu">' +
        '        <ul>' +
        '            <li>' +
        '                <a href="#" class="toggleDeviceLine">' +
        '                    <span class="icon-category-monitoring"></span>' +
        '                    <span>'+t('maps', 'Toggle device history')+'</span>' +
        '                </a>' +
        '            </li>' +
        '            <li>' +
        '                <a href="#" class="changeDeviceColor">' +
        '                    <span class="icon-rename"></span>' +
        '                    <span>'+t('maps', 'Change device color')+'</span>' +
        '                </a>' +
        '            </li>' +
        '            <li>' +
        '                <a href="#" class="zoomDeviceButton">' +
        '                    <span class="icon-search"></span>' +
        '                    <span>'+t('maps', 'Zoom to bounds')+'</span>' +
        '                </a>' +
        '            </li>' +
        '            <li>' +
        '                <a href="#" class="deleteDevice">' +
        '                    <span class="icon-delete"></span>' +
        '                    <span>'+t('maps', 'Delete')+'</span>' +
        '                </a>' +
        '            </li>' +
        '        </ul>' +
        '    </div>' +
        '    <div class="app-navigation-entry-deleted">' +
        '        <div class="app-navigation-entry-deleted-description">'+t('maps', 'Device deleted')+'</div>' +
        '        <button class="app-navigation-entry-deleted-button icon-history undoDeleteDevice" title="Undo"></button>' +
        '    </div>' +
        '</li>';

        var beforeThis = null;
        var nameLower = name.toLowerCase();
        var deviceName;
        $('#device-list > li').each(function() {
            deviceName = $(this).attr('name');
            if (nameLower.localeCompare(deviceName) < 0) {
                beforeThis = $(this);
                return false;
            }
        });
        if (beforeThis !== null) {
            $(li).insertBefore(beforeThis);
        }
        else {
            $('#device-list').append(li);
        }

        // enable if in saved options or if it should be enabled for another reason
        if (show || this.optionsController.enabledDevices.indexOf(id) !== -1) {
            this.toggleDevice(id, false, pageLoad);
        }
    },

    setDeviceCss: function(id, color) {
        $('style[device='+id+']').remove();

        var imgurl;
        if (['Windows', 'GNU/Linux', 'MacOS'].indexOf(this.devices[id].info.os) !== -1) {
            imgurl = OC.generateUrl('/svg/core/clients/desktop?color='+color.replace('#', ''));
        }
        else {
            imgurl = OC.generateUrl('/svg/core/clients/phone?color='+color.replace('#', ''));
        }
        $('<style device="' + id + '">' +
            '.tooltip-dev-' + id + ' { ' +
            'border: 2px solid ' + color + ';' +
            ' }' +
            '.devline' + id + ' {' +
            'stroke: ' + color + ';' +
            '}' +
            '.device-marker-'+id+' { ' +
            'border-color: '+color+';}' +
            '.device-marker-'+id+'::after {' +
            'border-color: '+color+' transparent !important;}' +
            '.device-marker-'+id+' .thumbnail { ' +
            'background-image: url(' + imgurl + ');}' +
            '.device-over-marker-' + id + ' { ' +
            'background: ' + color + ';' +
            'border: 1px solid grey;' +
            'width: 16px !important;' +
            'height: 16px !important;' +
            ' }' +
            '</style>').appendTo('body');
    },

    deleteDeviceDB: function(id) {
        var that = this;
        $('#navigation-devices').addClass('icon-loading-small');
        $('.leaflet-container').css('cursor', 'wait');
        var req = {};
        var url = OC.generateUrl('/apps/maps/devices/'+id);
        $.ajax({
            type: 'DELETE',
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            that.deleteDeviceMap(id);
        }).always(function (response) {
            $('#navigation-devices').removeClass('icon-loading-small');
            $('.leaflet-container').css('cursor', 'grab');
        }).fail(function() {
            OC.Notification.showTemporary(t('maps', 'Failed to delete device'));
        });
    },

    deleteDeviceMap: function(id) {
        this.mainLayer.removeLayer(this.mapDeviceLayers[id]);
        this.mapDeviceLayers[id].removeLayer(this.deviceLineLayers[id]);
        this.mapDeviceLayers[id].removeLayer(this.deviceMarkerLayers[id]);
        delete this.mapDeviceLayers[id];
        delete this.deviceLineLayers[id];
        delete this.deviceMarkerLayers[id];
        delete this.devices[id];

        $('style[device='+id+']').remove();

        $('#device-list > li[device="'+id+'"]').fadeOut('slow', function() {
            $(this).remove();
        });
    },

    saveEnabledDevices: function(additionalIds=[]) {
        var deviceList = [];
        var deviceWithLineList = [];
        var layer;
        for (var id in this.mapDeviceLayers) {
            layer = this.mapDeviceLayers[id];
            if (this.mainLayer.hasLayer(layer)) {
                deviceList.push(id);
            }
            if (this.devices[id].line && this.deviceLineLayers[id].hasLayer(this.devices[id].line)) {
                deviceWithLineList.push(id);
            }
        }
        for (var i=0; i < additionalIds.length; i++) {
            deviceList.push(additionalIds[i]);
        }
        var deviceStringList = deviceList.join('|');
        var deviceWithLineStringList = deviceWithLineList.join('|');
        this.optionsController.saveOptionValues({enabledDevices: deviceStringList});
        this.optionsController.saveOptionValues({enabledDeviceLines: deviceWithLineStringList});
        // this is used when devices are loaded again
        this.optionsController.enabledDevices = deviceList;
        this.optionsController.enabledDeviceLines = deviceWithLineList;
    },

    restoreDevicesState: function(enabledDeviceList) {
        var id;
        for (var i=0; i < enabledDeviceList.length; i++) {
            id = enabledDeviceList[i];
            if (this.mapDeviceLayers.hasOwnProperty(id)) {
                this.toggleDevice(id, false, true);
            }
        }
    },

    restoreDeviceLinesState: function(enabledDeviceLineList) {
        var id;
        for (var i=0; i < enabledDeviceLineList.length; i++) {
            id = enabledDeviceList[i];
            if (this.devices[id].line && this.deviceLineLayers.hasOwnProperty(id)) {
                this.toggleDeviceLine(id, false);
            }
        }
    },

    toggleDevice: function(id, save=false, pageLoad=false) {
        if (!this.devices[id].loaded) {
            this.loadDevicePoints(id, save, pageLoad);
        }
        this.toggleMapDeviceLayer(id);
        if (save) {
            this.saveEnabledDevices();
            this.updateMyFirstLastDates(true);
        }
    },

    toggleMapDeviceLayer: function(id) {
        var mapDeviceLayer = this.mapDeviceLayers[id];
        var deviceLi = $('#device-list > li[device="'+id+'"]');
        var deviceName = deviceLi.find('.device-name');
        // hide device
        if (this.mainLayer.hasLayer(mapDeviceLayer)) {
            this.mainLayer.removeLayer(mapDeviceLayer);
            deviceName.removeClass('active');
            $('#map').focus();
            // remove potential line marker
            if (this.lineMarker) {
                this.lineMarker.remove();
                this.lineMarker = null;
            }
        }
        // show device
        else {
            this.mainLayer.addLayer(mapDeviceLayer);
            if (this.devices[id].marker) {
                this.devices[id].marker.setZIndexOffset(this.lastZIndex++);
            }
            deviceName.addClass('active');
        }
    },

    toggleDeviceLine: function(id, save=false) {
        var deviceLineLayer = this.deviceLineLayers[id];
        var line = this.devices[id].line;
        // if line layer already exist
        if (line) {
            // hide line
            if (deviceLineLayer.hasLayer(line)) {
                deviceLineLayer.removeLayer(line);
                // remove potential line marker
                if (this.lineMarker) {
                    this.lineMarker.remove();
                    this.lineMarker = null;
                }
            }
            // show line
            else {
                deviceLineLayer.addLayer(line);
            }
            if (save) {
                this.saveEnabledDevices();
            }
        }
    },

    // load all available points and create marker/line
    loadDevicePoints: function(id, save=false, pageLoad=false) {
        var that = this;
        $('#device-list > li[device="'+id+'"]').addClass('icon-loading-small');
        var req = {};
        var url = OC.generateUrl('/apps/maps/devices/'+id);
        $.ajax({
            type: 'GET',
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            that.addPoints(id, response);
            that.devices[id].loaded = true;
            that.updateMyFirstLastDates(pageLoad);
        }).always(function (response) {
            $('#device-list > li[device="'+id+'"]').removeClass('icon-loading-small');
        }).fail(function() {
            OC.Notification.showTemporary(t('maps', 'Failed to load device points'));
        });
    },

    // handle first data received for the device
    addPoints: function(id, points) {
        var lastPoint = points[points.length - 1];
        this.devices[id].marker = L.marker([lastPoint.lat, lastPoint.lng, lastPoint.id], {
                icon: this.devices[id].icon
        });
        this.devices[id].marker.devid = id;
        this.devices[id].marker.lastPosMarker = true;
        this.devices[id].marker.on('mouseover', this.deviceMarkerMouseover);
        this.devices[id].marker.on('mouseout', this.deviceMarkerMouseout);
        this.devices[id].marker.on('contextmenu', this.deviceMarkerMouseRightClick);
        //this.devices[id].marker.on('click', this.favoriteMouseClick);
        // points data indexed by point id
        this.devices[id].points = {};
        // points coordinates (with id as third element)
        this.devices[id].pointsLatLngId = [];
        for (var i=0; i < points.length; i++) {
            this.devices[id].pointsLatLngId.push([points[i].lat, points[i].lng, points[i].id]);
            this.devices[id].points[points[i].id] = points[i];
        }
        this.devices[id].line = L.polyline(this.devices[id].pointsLatLngId, {
            weight: 4,
            opacity : 1,
            className: 'devline'+id,
        });
        this.devices[id].line.devid = id;
        this.devices[id].line.on('mouseover', this.deviceLineMouseover);
        this.devices[id].line.on('mouseout', this.deviceLineMouseout);
        this.devices[id].line.on('contextmenu', this.deviceMarkerMouseRightClick);
        this.deviceMarkerLayers[id].addLayer(this.devices[id].marker);
        if (this.optionsController.enabledDeviceLines.indexOf(id) !== -1) {
            this.deviceLineLayers[id].addLayer(this.devices[id].line);
        }
    },

    // device already exists and has points, check if there are new points
    updateDevicePoints: function(id) {
        var that = this;
        // get last device point
        var ts = null;
        if (this.devices[id].pointsLatLngId && this.devices[id].pointsLatLngId.length > 0) {
            var pid = this.devices[id].pointsLatLngId[this.devices[id].pointsLatLngId.length - 1][2];
            ts = this.devices[id].points[pid].timestamp;
        }
        $('#device-list > li[device="'+id+'"]').addClass('icon-loading-small');
        var req = {};
        if (ts) {
            req.pruneBefore = ts;
        }
        var url = OC.generateUrl('/apps/maps/devices/'+id);
        $.ajax({
            type: 'GET',
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            that.appendPoints(id, response);
            that.updateMyFirstLastDates(true);
            that.updateFilterDisplay();
        }).always(function (response) {
            $('#device-list > li[device="'+id+'"]').removeClass('icon-loading-small');
        }).fail(function() {
            OC.Notification.showTemporary(t('maps', 'Failed to update device points'));
        });
    },

    appendPoints: function(id, points) {
        for (var i=0; i < points.length; i++) {
            this.devices[id].pointsLatLngId.push([points[i].lat, points[i].lng, points[i].id]);
            this.devices[id].points[points[i].id] = points[i];
        }
    },

    updateMyFirstLastDates: function(updateSlider=false) {
        if (!this.map.hasLayer(this.mainLayer)) {
            this.firstDate = null;
            this.lastDate = null;
        }
        else {
            var id;

            // we update dates only if nothing is currently loading
            for (id in this.mapDeviceLayers) {
                if (this.mainLayer.hasLayer(this.mapDeviceLayers[id]) && !this.devices[id].loaded) {
                    return;
                }
            }

            var initMinDate = Math.floor(Date.now() / 1000) + 1000000
            var initMaxDate = 0;

            var first = initMinDate;
            var last = initMaxDate;
            var fpId, lpId, firstPoint, lastPoint;
            for (id in this.mapDeviceLayers) {
                if (this.mainLayer.hasLayer(this.mapDeviceLayers[id]) && this.devices[id].loaded) {
                    fpId = this.devices[id].pointsLatLngId[0][2];
                    lpId = this.devices[id].pointsLatLngId[this.devices[id].pointsLatLngId.length - 1][2];
                    firstPoint = this.devices[id].points[fpId];
                    lastPoint = this.devices[id].points[lpId];
                    if (firstPoint.timestamp && firstPoint.timestamp < first) {
                        first = firstPoint.timestamp;
                    }
                    if (lastPoint.timestamp && lastPoint.timestamp > last) {
                        last = lastPoint.timestamp;
                    }
                }
            }
            if (first !== initMinDate
                && last !== initMaxDate) {
                this.firstDate = first;
                this.lastDate = last;
            }
            else {
                this.firstDate = null;
                this.lastDate = null;
            }
        }
        if (updateSlider) {
            this.timeFilterController.updateSliderRangeFromController();
            this.timeFilterController.setSliderToMaxInterval();
        }
    },

    updateFilterDisplay: function() {
        var startFilter = this.timeFilterController.valueBegin;
        var endFilter = this.timeFilterController.valueEnd;
        var id, i, pointsLLI, points, latLngToDisplay;
        for (id in this.devices) {
            if (this.devices[id].loaded) {
                latLngToDisplay = [];
                pointsLLI = this.devices[id].pointsLatLngId;
                points = this.devices[id].points;
                i = 0;
                while (i < pointsLLI.length && points[pointsLLI[i][2]].timestamp < startFilter) {
                    i++;
                }
                while (i < pointsLLI.length && points[pointsLLI[i][2]].timestamp <= endFilter) {
                    latLngToDisplay.push(pointsLLI[i]);
                    i++;
                }
                if (latLngToDisplay.length > 0) {
                    this.devices[id].line.setLatLngs(latLngToDisplay);
                    this.devices[id].marker.setLatLng(latLngToDisplay[latLngToDisplay.length - 1]);
                    if (!this.mapDeviceLayers[id].hasLayer(this.deviceLineLayers[id])) {
                        this.mapDeviceLayers[id].addLayer(this.deviceLineLayers[id]);
                    }
                    if (!this.mapDeviceLayers[id].hasLayer(this.deviceMarkerLayers[id])) {
                        this.mapDeviceLayers[id].addLayer(this.deviceMarkerLayers[id]);
                    }
                }
                else {
                    this.mapDeviceLayers[id].removeLayer(this.deviceLineLayers[id]);
                    this.mapDeviceLayers[id].removeLayer(this.deviceMarkerLayers[id]);
                }
            }
        }
    },

    refreshAllDevices: function() {
        // first get new positions for devices we already have
        for (var id in this.devices) {
            this.updateDevicePoints(id);
        }
        // then get potentially missing devices
        this.getDevices();
    },

    launchTrackLoop: function() {
        this.sendPositionLoop();
    },

    stopTrackLoop: function() {
        if (this.sendPositionTimer) {
            this.sendPositionTimer.pause();
            delete this.sendPositionTimer;
            this.sendPositionTimer = null;
        }
    },

    sendPositionLoop: function() {
        var that = this;
        // start a loop which get and send my position
        if (navigator.geolocation && window.isSecureContext) {
            navigator.geolocation.getCurrentPosition(function (position) {
                var lat = position.coords.latitude;
                var lng = position.coords.longitude;
                var acc = position.coords.accuracy;
                that.sendMyPosition(lat, lng, acc);
                // loop
                that.stopTrackLoop();
                that.sendPositionTimer = new Timer(function() {
                    that.sendPositionLoop();
                }, 5 * 60 * 1000);
            });
        }
        else {
            OC.Notification.showTemporary(t('maps', 'Impossible to get current location'));
        }
    },

    sendMyPosition: function(lat, lng, acc) {
        var that = this;
        var ts = Math.floor(Date.now() / 1000);
        var req = {
            lat: lat,
            lng: lng,
            accuracy: acc,
            timestamp: ts
        };
        var url = OC.generateUrl('/apps/maps/devices');
        $.ajax({
            type: 'POST',
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            // TODO get new positions
        }).always(function (response) {
        }).fail(function() {
            OC.Notification.showTemporary(t('maps', 'Failed to send current position'));
        });
    },

    zoomOnDevice: function(id) {
        if (this.mainLayer.hasLayer(this.mapDeviceLayers[id])) {
            this.map.fitBounds(this.mapDeviceLayers[id].getBounds(), {padding: [30, 30]});
            this.mapDeviceLayers[id].bringToFront();
            this.devices[id].marker.setZIndexOffset(this.lastZIndex++);
        }
    },

    askChangeDeviceColor: function(id) {
        this.changingColorOf = id;
        var currentColor = this.devices[id].color;
        $('#devicecolorinput').val(currentColor);
        $('#devicecolorinput').click();
    },

    okColor: function() {
        var color = $('#devicecolorinput').val();
        var id = this.changingColorOf;
        this.devices[id].color = color;
        this.changeDeviceColor(id, color);
    },

    changeDeviceColor: function(id, color) {
        var that = this;
        $('#device-list > li[device="'+id+'"]').addClass('icon-loading-small');
        var req = {
            color: color
        };
        var url = OC.generateUrl('/apps/maps/devices/'+id);
        $.ajax({
            type: 'PUT',
            url: url,
            data: req,
            async: true
        }).done(function (response) {
            var imgurl;
            var device = that.devices[id];
            if (['Windows', 'GNU/Linux', 'MacOS'].indexOf(device.info.os) !== -1) {
                imgurl = OC.generateUrl('/svg/core/clients/desktop?color='+color.replace('#', ''));
            }
            else {
                imgurl = OC.generateUrl('/svg/core/clients/phone?color='+color.replace('#', ''));
            }
            $('#device-list > li[device='+id+'] .device-name').attr('style', 'background-image: url('+imgurl+')');

            that.setDeviceCss(id, color);
        }).always(function (response) {
            $('#device-list > li[device="'+id+'"]').removeClass('icon-loading-small');
        }).fail(function(response) {
            OC.Notification.showTemporary(t('maps', 'Failed to change device color') + ': ' + response.responseText);
        });
    },

    deviceMarkerMouseover: function(e) {
        var that = this._map.devicesController;
        var id = e.target.devid;
        var pointId = e.target.getLatLng().alt;
        var device = that.devices[id];
        var yOffset = 0;
        if (e.target.lastPosMarker) {
            yOffset = -20;
        }
        // tooltip
        var markerTooltip = that.getDeviceMarkerTooltipContent(device, pointId);
        e.target.bindTooltip(markerTooltip, {
            className: 'leaflet-marker-device-tooltip tooltip-dev-' + id,
            direction: 'top',
            offset: L.point(0, yOffset)
        });
        e.target.openTooltip();
        // accuracy circle
        var latlng = e.target.getLatLng();
        var acc = that.devices[id].points[pointId].accuracy;
        if (acc) {
            that.currentPrecisionCircle = L.circle(latlng, {radius: acc});
            that.map.addLayer(that.currentPrecisionCircle);
        }
        else {
            that.currentPrecisionCircle = null;
        }
    },

    deviceMarkerMouseout: function(e) {
        // tooltip
        e.target.unbindTooltip();
        e.target.closeTooltip();
        // accuracy circle
        var that = this._map.devicesController;
        if (that.currentPrecisionCircle !== null &&
            that.map.hasLayer(that.currentPrecisionCircle)
        ) {
            that.map.removeLayer(that.currentPrecisionCircle);
            that.currentPrecisionCircle = null;
        }
    },

    getDeviceMarkerTooltipContent: function(device, pointId) {
        var point = device.points[pointId];
        var content = '⊙ ' + t('maps', 'Device') + ': ' + brify(device.name, 30);
        content = content + '<br/>' + '⊙ ' + t('maps', 'Date') + ': ' + (new Date(point.timestamp * 1000)).toIsoString();
        if (point.altitude !== null) {
            content = content + '<br/>' + '⊙ ' + t('maps', 'Elevation') + ': ' + point.altitude.toFixed(2);
        }
        if (point.accuracy !== null) {
            content = content + '<br/>' + '⊙ ' + t('maps', 'Accuracy') + ': ' + point.accuracy.toFixed(2);
        }
        if (point.battery !== null) {
            content = content + '<br/>' + '⊙ ' + t('maps', 'Battery') + ': ' + point.battery.toFixed(2);
        }
        return content;
    },

    deviceLineMouseover: function(e) {
        var that = this._map.devicesController;
        if (that.lineMarker) {
            that.lineMarker.remove();
            that.lineMarker = null;
        }
        var id = e.target.devid;
        var overLatLng = this._map.layerPointToLatLng(e.layerPoint);
        var minDist = 40000000;
        var markerLatLng = null;
        var tmpDist;
        var lineLatLngs = e.target.getLatLngs();
        for (var i=0; i < lineLatLngs.length; i++) {
            tmpDist = this._map.distance(overLatLng, lineLatLngs[i]);
            if (tmpDist < minDist) {
                markerLatLng = lineLatLngs[i];
                minDist = tmpDist;
            }
        }
        that.lineMarker = L.marker(markerLatLng,
            {icon: that.devices[id].overicon}
        );
        that.lineMarker.devid = id;
        that.lineMarker.on('mouseover', that.deviceMarkerMouseover);
        that.lineMarker.on('mouseout', that.deviceMarkerMouseout);
        that.lineMarker.on('contextmenu', that.deviceMarkerMouseRightClick);
        that.map.addLayer(that.lineMarker);
    },

    deviceLineMouseout: function(e) {
    },

    deviceMarkerMouseRightClick: function(e) {
        var id = e.target.devid;

        e.target.unbindPopup();
        var popupContent = this._map.devicesController.getDeviceContextPopupContent(id);
        e.target.bindPopup(popupContent, {
            closeOnClick: true,
            className: 'popovermenu open popupMarker',
            offset: L.point(-4, 5)
        });
        e.target.openPopup(e.latlng);
        e.preventDefault();
    },

    getDeviceContextPopupContent: function(id) {
        var colorText = t('maps', 'Change device color');
        var lineText = t('maps', 'Toggle device history');
        var res =
            '<ul devid="' + id + '">' +
            '   <li>' +
            '       <button class="icon-category-monitoring contextToggleLine">' +
            '           <span>' + lineText + '</span>' +
            '       </button>' +
            '   </li>' +
            '   <li>' +
            '       <button class="icon-rename contextChangeDeviceColor">' +
            '           <span>' + colorText + '</span>' +
            '       </button>' +
            '   </li>' +
            '</ul>';
        return res;
    },

    getAutocompData: function() {
        var that = this;
        var marker, devid;
        var data = [];
        if (this.map.hasLayer(this.mainLayer)) {
            for (devid in this.devices) {
                // is activated
                if (this.mainLayer.hasLayer(this.mapDeviceLayers[devid])) {
                    // is not filtered
                    if (this.mapDeviceLayers[devid].hasLayer(this.deviceMarkerLayers[devid])) {
                        marker = this.devices[devid].marker;
                        data.push({
                            type: 'device',
                            label: this.devices[devid].name,
                            value: this.devices[devid].name,
                            lat: marker.getLatLng().lat,
                            lng: marker.getLatLng().lng
                        });
                    }
                }
            }
        }
        return data;
    },

}

