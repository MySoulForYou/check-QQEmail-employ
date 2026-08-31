/**
 * 招聘智能助手 V3.0 - 高性能云原生 Supabase 客户端 (Zero-Dependency)
 * 支持 RESTful API 查询与 Phoenix WebSocket Realtime 毫秒级数据订阅
 */
(function (global) {
    class SupabaseQueryBuilder {
        constructor(baseUrl, key, table) {
            this.baseUrl = baseUrl.replace(/\/$/, '') + '/rest/v1/' + table;
            this.key = key;
            this.params = [];
            this.method = 'GET';
            this.body = null;
        }

        select(fields = '*') {
            this.params.push('select=' + encodeURIComponent(fields));
            return this;
        }

        in(column, values) {
            if (Array.isArray(values) && values.length > 0) {
                this.params.push(column + '=in.(' + values.map(encodeURIComponent).join(',') + ')');
            }
            return this;
        }

        eq(column, value) {
            this.params.push(column + '=eq.' + encodeURIComponent(value));
            return this;
        }

        neq(column, value) {
            this.params.push(column + '=neq.' + encodeURIComponent(value));
            return this;
        }

        lt(column, value) {
            this.params.push(column + '=lt.' + encodeURIComponent(value));
            return this;
        }

        lte(column, value) {
            this.params.push(column + '=lte.' + encodeURIComponent(value));
            return this;
        }

        gt(column, value) {
            this.params.push(column + '=gt.' + encodeURIComponent(value));
            return this;
        }

        gte(column, value) {
            this.params.push(column + '=gte.' + encodeURIComponent(value));
            return this;
        }

        order(column, { ascending = true } = {}) {
            this.params.push('order=' + encodeURIComponent(column) + '.' + (ascending ? 'asc' : 'desc'));
            return this;
        }

        limit(count) {
            this.params.push('limit=' + count);
            return this;
        }

        update(payload) {
            this.method = 'PATCH';
            this.body = payload;
            return this;
        }

        insert(payload) {
            this.method = 'POST';
            this.body = payload;
            return this;
        }

        async execute() {
            const queryStr = this.params.length ? '?' + this.params.join('&') : '';
            const url = this.baseUrl + queryStr;
            const headers = {
                'apikey': this.key,
                'Authorization': 'Bearer ' + this.key,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            };

            try {
                const res = await fetch(url, {
                    method: this.method,
                    headers: headers,
                    body: this.body ? JSON.stringify(this.body) : undefined
                });

                if (!res.ok) {
                    const errText = await res.text();
                    let errObj;
                    try { errObj = JSON.parse(errText); } catch(e) { errObj = { message: errText }; }
                    return { data: null, error: errObj };
                }

                const data = await res.json();
                return { data, error: null };
            } catch (err) {
                return { data: null, error: err };
            }
        }

        then(resolve, reject) {
            return this.execute().then(resolve, reject);
        }
    }

    class RealtimeChannel {
        constructor(wsUrl, key, channelName) {
            this.wsUrl = wsUrl;
            this.key = key;
            this.channelName = channelName;
            this.callbacks = [];
            this.statusCallbacks = [];
            this.ws = null;
            this.heartbeatTimer = null;
            this.refCounter = 1;
            this.isClosed = false;
        }

        on(type, filter, callback) {
            if (type === 'postgres_changes') {
                this.callbacks.push(callback);
            }
            return this;
        }

        subscribe(statusCallback) {
            if (statusCallback) this.statusCallbacks.push(statusCallback);
            this._connect();
            return this;
        }

        _connect() {
            if (this.isClosed) return;
            try {
                const socketUrl = `${this.wsUrl}/realtime/v1/websocket?apikey=${this.key}&vsn=1.0.0`;
                this.ws = new WebSocket(socketUrl);

                this.ws.onopen = () => {
                    this._notifyStatus('SUBSCRIBED');
                    this._join();
                    this._startHeartbeat();
                };

                this.ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.event === 'postgres_changes' || (msg.event === 'phx_reply' && msg.payload?.status === 'ok')) {
                            if (msg.event === 'postgres_changes') {
                                this.callbacks.forEach(cb => cb(msg.payload));
                            }
                        }
                    } catch (e) {
                        console.warn('Realtime 报文解析异常:', e);
                    }
                };

                this.ws.onclose = () => {
                    this._stopHeartbeat();
                    this._notifyStatus('CLOSED');
                    if (!this.isClosed) {
                        setTimeout(() => this._connect(), 5000);
                    }
                };

                this.ws.onerror = (err) => {
                    this._notifyStatus('CHANNEL_ERROR');
                };
            } catch (e) {
                this._notifyStatus('CHANNEL_ERROR');
            }
        }

        _join() {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            const joinMsg = {
                topic: `realtime:public:${this.channelName}`,
                event: 'phx_join',
                payload: {
                    config: {
                        postgres_changes: [{ event: '*', schema: 'public', table: 'tasks' }]
                    }
                },
                ref: String(this.refCounter++)
            };
            this.ws.send(JSON.stringify(joinMsg));
        }

        _startHeartbeat() {
            this._stopHeartbeat();
            this.heartbeatTimer = setInterval(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        topic: 'phoenix',
                        event: 'heartbeat',
                        payload: {},
                        ref: String(this.refCounter++)
                    }));
                }
            }, 25000);
        }

        _stopHeartbeat() {
            if (this.heartbeatTimer) {
                clearInterval(this.heartbeatTimer);
                this.heartbeatTimer = null;
            }
        }

        _notifyStatus(status) {
            this.statusCallbacks.forEach(cb => {
                try { cb(status); } catch(e) {}
            });
        }

        unsubscribe() {
            this.isClosed = true;
            this._stopHeartbeat();
            if (this.ws) {
                this.ws.close();
            }
        }
    }

    class SupabaseClient {
        constructor(supabaseUrl, supabaseKey) {
            this.supabaseUrl = supabaseUrl.replace(/\/$/, '');
            this.supabaseKey = supabaseKey;
            this.wsUrl = this.supabaseUrl.replace(/^http/, 'ws');
        }

        from(table) {
            return new SupabaseQueryBuilder(this.supabaseUrl, this.supabaseKey, table);
        }

        channel(name) {
            return new RealtimeChannel(this.wsUrl, this.supabaseKey, name);
        }
    }

    global.supabase = {
        createClient: function (url, key) {
            return new SupabaseClient(url, key);
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
