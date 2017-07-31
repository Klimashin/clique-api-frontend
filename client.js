class AjaxRequest {
	constructor(request, success, error){
		if (request.method == null) request.method = "GET";
		var xmlhttp = new XMLHttpRequest();
		xmlhttp.onreadystatechange = function() {
        	if (xmlhttp.readyState == XMLHttpRequest.DONE ) {
        		if (xmlhttp.status >= 200 && xmlhttp.status < 400) {
            		success(xmlhttp.status, xmlhttp.response);
           		}
           		else {
            		error(xmlhttp.status);
           		}
        	}
    	};

    	xmlhttp.responseType = request.dataType.toLowerCase()||"";
    	var params = "";
    	for (var key in request.data) {
    		params = params + "&" + key + "=" + request.data[key];
    	}
    	params = params.replace("&","");

    	xmlhttp.open(request.method, request.url + ( (request.method === "GET" && params) ? "?"+params : ""), true);
    	xmlhttp.setRequestHeader("X-Requested-With", "XMLHttpRequest");
    	if (request.bearer) xmlhttp.setRequestHeader('Authorization', 'Bearer ' + request.bearer);
    	if (request.req_user) xmlhttp.setRequestHeader('X-Request-User', request.req_user);
    	if (request.method !== "GET") 
    	{
			xmlhttp.setRequestHeader("Content-Type","application/x-www-form-urlencoded");
			xmlhttp.send(params); 
    	} 
    	else xmlhttp.send();
	}
}

class CliqueClient {

	constructor(user_id, user_token, event_handlers, is_test)
	{
		var api_endpoint = is_test ? "https://test.caw.me/api" : "https://caw.me/api";
		var self = this;
		if (typeof SIP === 'undefined') throw new Error("SIP.js is not available");
		if (typeof io === 'undefined') throw new Error("Socket.io is not available");

		self.api_endpoint = api_endpoint;
		self.user_token = user_token;
		self.event_handlers = event_handlers;
		self.is_test = is_test;
		self.conferences = {};
		self.phones = {};
		self.calls = {};
		self.user_token = user_token;
		self.user_id = user_id;

		for (var i in self.event_handlers){
			var n_i = i.replace("-","_");
			self.event_handlers[n_i] = self.event_handlers[i];
			//delete self.event_handlers[i];
		}

		new AjaxRequest( { url : self.api_endpoint + "/v2/users/?uuid=" + user_id, dataType : "JSON", bearer: user_token, req_user:user_id },
			function(status, data){
				if (!data.ok) return self.error('API error', data);

				self.user = data.result[0];
				if (self.event_handlers.init) self.event_handlers.init();
			}, 
			function(error){
				self.error('HTTP_ERROR', error);
			}
		);
	}

	handleEvents()
	{
		var self = this;
		self.socket.on('event',function(event){
		    //TODO: replace this with switch statement
		    if (event.Action == 'add-member' && event["Caller-Caller-ID-Number"] != self.user.sip_id) {
		    	if (self.event_handlers.member_join) self.event_handlers.member_join(event.Room, {user: event.User});
		    }
		    if (event.Action == 'del-member' && event["Caller-Caller-ID-Number"] != self.user.sip_id) {
		    	if (self.event_handlers.member_leave) self.event_handlers.member_leave(event.Room, {user_id: event['Caller-Caller-ID-Number']});
		    }
		    if (event.Action == 'start-talking') {
		    	if (self.event_handlers.start_talking) self.event_handlers.start_talking(event.Room, {user_id: event['Caller-Caller-ID-Number']});
		    }
		    if (event.Action == 'stop-talking') {
		    	if (self.event_handlers.stop_talking) self.event_handlers.stop_talking(event.Room, {user_id: event['Caller-Caller-ID-Number']});
		    }
		    if (event.Action === "mute-member" && event["Caller-Caller-ID-Number"] == self.user_sip_id) {
		    	if (self.event_handlers.mute_member) self.event_handlers.mute_member(event.Room, {user_id: event['Caller-Caller-ID-Number']});
		    }
		    if (event.Action === "unmute-member" && event["Caller-Caller-ID-Number"] == self.user_sip_id) {
		    	if (self.event_handlers.unmute_member) self.event_handlers.unmute_member(event.Room, {user_id: event['Caller-Caller-ID-Number']});
		    }
		    if (event.Action === "kick-member" && event["Caller-Caller-ID-Number"] == self.user_sip_id) {
		    	if (self.event_handlers.kick_member) self.event_handlers.kick_member(event.Room, {user: event.User});
		    }
		    if (event.Action === "conference-destroy") {
		    	if (self.event_handlers.conference_destroy) self.event_handlers.conference_destroy(event.Room, {});
		    }
		    if (event.Action === "conference-create") {
		    	if (self.event_handlers.conference_create) self.event_handlers.conference_create(event.Room, {});
		    }
		    if (event.Action === "call-status-amd" && event.Status.toLowerCase() === 'voicemail') {
		    	if (self.event_handlers.beep) self.event_handlers.beep(event['Caller-Callee-ID-Number'], {});
		    }
		    if (event.Action === "call-status-amd" && event.Status.toLowerCase() !== 'voicemail') {
		    	if (self.event_handlers.live_call) self.event_handlers.live_call(event['Caller-Callee-ID-Number'], { status: event.Status.toLowerCase() });
		    }

		});

	}

	initUA(conference)
	{
		var self = this;

		if (! self.socket) 
		{
			self.socket = io.connect(self.is_test ? "https://test.caw.me/" : "https://caw.me/", { query: `conference_id=${conference.id}&token=${self.user_token}&user_uuid=${self.user.uuid}` });
			self.handleEvents();
		} else {
			self.socket.emit('join', conference.id);
		}

		return new Promise( (resolve, reject) => {
			if (!self.phones[conference.node_domain]) 
				self.phones[conference.node_domain] = new SIP.UA({
					uri: self.user.sip_id + "@" + (self.is_test?'test.':'') + "caw.me"
					,password: self.user.sip_pwd
					,wsServers: "wss://" + conference.node_domain + ":443"
					,register: false
					,rel100: SIP.C.supported.SUPPORTED
					,traceSip: self.is_test
					,iceCheckingTimeout: 3000
				});
			else return resolve(self.phones[conference.node_domain]);

			if (self.event_handlers.connected) self.phones[conference.node_domain].on('connected', function(){ self.event_handlers.connected(); resolve(); });
			if (self.event_handlers.disconnected) self.phones[conference.node_domain].on('disconnected', function(){ self.event_handlers.disconnected() });
			resolve(self.phones[conference.node_domain]);
		});
	}

	initCallUA(){
		var self = this;
		return new Promise( (resolve, reject) => { 
			new AjaxRequest({ url : self.api_endpoint + "/v2/nodes", dataType : "JSON", bearer: self.user_token, req_user:self.user_id },
				function (status, data) {
					var minLoad = 101;
					var minIndex = 0;
					for(var i in data.result){
						if(data.result[i].cpu_load < minLoad) {
							minLoad = data.result[i].cpu_load;
							minIndex = i;
						}
					}
					var node = data.result[minIndex];
					if(typeof node === 'undefined') return reject();
					if (!self.phones[node.domain_name]) 
						self.phones[node.domain_name] = new SIP.UA({
							uri: self.user.sip_id + "@" + (self.is_test?'test.':'') + "caw.me"
							,password: self.user.sip_pwd
							,wsServers: "wss://" + node.domain_name + ":443"
							,register: false
							,reliable: "required"
							,traceSip: self.is_test
							,iceCheckingTimeout: 3000
						});
					else return resolve(self.phones[node.domain_name]);

					if (self.event_handlers.connected) self.phones[node.domain_name].on('connected', function(){ self.event_handlers.connected(); resolve(); });
					if (self.event_handlers.disconnected) self.phones[node.domain_name].on('disconnected', function(){ self.event_handlers.disconnected() });
					resolve(self.phones[node.domain_name]);
				},
				function (error) {
					return reject();
				}
			);
		});


	}

	error(code, data) 
	{
		var self = this;
		if (this.is_test) console.log(code, data);
		if (self.event_handlers.error) self.event_handlers.error(code, data);
	}
	
	createRoom()
	{
		var self = this;

		return new Promise((resolve, reject) => {
			new AjaxRequest( { 
					url : self.api_endpoint + "/v2/conferences/", 
					method: 'POST', 
					dataType : "JSON", 
					bearer: self.user_token, 
					req_user: self.user.uuid,
					data: { creator_uuid: self.user.uuid, node_autoassign: true}
				},
				function(status, data){
					if (!data.ok) return self.error('API error', data);

					self.conferences[data.conference.id] = data.conference;
					self.conferences[data.conference.id].isModerator = true;
					
					self.initUA(data.conference).then(
						function () {

							var audioElement = document.createElement('audio');
							audioElement.id = data.conference.id;
							audioElement.style.display = 'none';

							var id = data.conference.id;

							document.body.appendChild(audioElement);

							self.calls[data.conference.id] = self.phones[data.conference.node_domain].invite("conference_" + data.conference.id, {
							    media: {
							    	render: {remote: audioElement}
						            ,constraints: {
						              audio: true,
						              video: false
						        	}
							    }
							});

							self.calls[data.conference.id].on('accepted', 
								function(){
									if (self.event_handlers.room_join) self.event_handlers.room_join(data.conference.id,{user:self.user});
								}
							);
							self.calls[data.conference.id].on('terminated', 
								function(){
									if (self.event_handlers.room_leave) self.event_handlers.room_leave(data.conference.id,{user:self.user});
									self.socket.emit('leave', data.conference.id);
									self.calls[id] = undefined;
								}
							);
						},
						function (error) {
						// body...
						}
					);

					resolve(data.conference.id);
				}, 
				function(error){
					self.error('HTTP_ERROR', error);
					reject(error);
				}
			);
		});
	}

	dial(number, options){
		var self = this;
		return new Promise((resolve, reject) => {
			if(typeof self.calls[number] !== 'undefined') return reject();
			self.initCallUA().then(function (ua) {
				var audioElement = document.createElement('audio');
				audioElement.id = number;
				audioElement.style.display = 'none';

				var id = number;
				var headers = [];

				if(options && options.source) { headers.push('X-Clique-Source-Number: ' + options.source); }
				if(options && options.detect_live) { headers.push('X-Clique-Live-Answer: true'); }
				if(options && options.detect_beep) { headers.push('X-Clique-Detect-Beep: true'); }

				document.body.appendChild(audioElement);

				self.calls[number] = ua.invite(number, {
					extraHeaders: headers,
				    media: {
				    	render: {remote: audioElement}
			            ,constraints: {
			              audio: true,
			              video: false
			        	}
				    }
				});

				self.calls[number].on('accepted', 
					function(){
						if (self.event_handlers.call_accepted) self.event_handlers.call_accepted(number);
					}
				);
				self.calls[number].on('terminated', 
					function(message, cause){
						if (self.event_handlers.call_ended) self.event_handlers.call_ended(number, cause);
						self.calls[id] = undefined;
					}
				);
				return resolve();
			},
			function () {
				// body...
			});
		});
	}

	hangup(number)
	{
		var self = this;
		self.calls[number].terminate();
	}

	joinRoom(conference_id)
	{
		var self = this;

		return new Promise((resolve, reject) => {
			if(typeof self.calls[conference_id] !== 'undefined') return reject();
			new AjaxRequest( { 
					url : self.api_endpoint + "/v2/conferences/" + conference_id, 
					method: 'GET', 
					dataType : "JSON", 
					bearer: self.user_token, 
					req_user: self.user.uuid
				},
				function(status, data){
					if (!data.ok) return self.error('API error', data);

					self.conferences[data.conference.id] = data.conference;
					
					self.initUA(data.conference).then(
						function () {

							var audioElement = document.createElement('audio');
							audioElement.id = data.conference.id;
							audioElement.style.display = 'none';

							document.body.appendChild(audioElement);

							self.calls[data.conference.id] = self.phones[data.conference.node_domain].invite("conference_" + data.conference.id, {
							    media: {
							    	render: {remote: audioElement}
						            ,constraints: {
						              audio: true,
						              video: false
						        	}
							    }
							});

							self.calls[data.conference.id].on('accepted', 
								function(){
									if (self.event_handlers.room_join) self.event_handlers.room_join(data.conference.id,{user:self.user});
								}
							);
							self.calls[data.conference.id].on('terminated', 
								function(){
									if (self.event_handlers.room_leave) self.event_handlers.room_leave(data.conference.id,{user:self.user});
								}
							);
						},
						function (error) {
						// body...
						}
					);

					resolve(data.conference.id);
				}, 
				function(error){
					self.error('HTTP_ERROR', error);
					reject(error);
				}
			);
		});

	}

	closeRoom(conference_id)
	{
		var self = this;
		self.calls[conference_id].terminate();
	}

	localMute(conference_id)
	{
		var self = this;
		self.calls[conference_id].mute();
	}

	localUnmute(conference_id)
	{
		var self = this;
		self.calls[conference_id].unmute();
	}

	localVolume(conference_id, volume)
	{
		var self = this;
		var v = document.getElementById(conference_id).volume*100;
		if (typeof volume === 'undefined') return v; else document.getElementById(conference_id).volume = volume/100;
	}
}
