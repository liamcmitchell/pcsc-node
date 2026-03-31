#include "pcsc_reader.h"
#include "pcsc_errors.h"
#include <cstring>

Napi::FunctionReference PCSCReader::constructor;

// ============================================================================
// Async Workers (private to this translation unit)
// ============================================================================

class ConnectWorker : public Napi::AsyncWorker {
public:
    ConnectWorker(Napi::Env env,
                  PCSCReader* reader,
                  DWORD shareMode,
                  DWORD preferredProtocols,
                  Napi::Promise::Deferred deferred)
        : Napi::AsyncWorker(env),
          reader_(reader),
          shareMode_(shareMode),
          preferredProtocols_(preferredProtocols),
          card_(0),
          activeProtocol_(0),
          result_(SCARD_S_SUCCESS),
          deferred_(deferred) {}

    void Execute() override {
        result_ = SCardConnect(
            reader_->context_,
            reader_->readerName_.c_str(),
            shareMode_,
            preferredProtocols_,
            &card_,
            &activeProtocol_
        );
    }

    void OnOK() override {
        Napi::Env env = Env();
        if (result_ == SCARD_S_SUCCESS) {
            reader_->card_ = card_;
            reader_->protocol_ = activeProtocol_;
            reader_->connected_ = true;
            deferred_.Resolve(env.Undefined());
        } else {
            deferred_.Reject(Napi::Error::New(env, GetPCSCErrorString(result_)).Value());
        }
    }

    void OnError(const Napi::Error& error) override {
        deferred_.Reject(error.Value());
    }

private:
    PCSCReader* reader_;
    DWORD shareMode_;
    DWORD preferredProtocols_;
    SCARDHANDLE card_;
    DWORD activeProtocol_;
    LONG result_;
    Napi::Promise::Deferred deferred_;
};

class TransmitWorker : public Napi::AsyncWorker {
public:
    TransmitWorker(Napi::Env env,
                   SCARDHANDLE card,
                   DWORD protocol,
                   std::vector<uint8_t> sendBuffer,
                   size_t maxRecvLength,
                   Napi::Promise::Deferred deferred)
        : Napi::AsyncWorker(env),
          card_(card),
          protocol_(protocol),
          sendBuffer_(std::move(sendBuffer)),
          recvLength_(0),
          result_(SCARD_S_SUCCESS),
          deferred_(deferred) {
        size_t bufferSize = maxRecvLength;
        if (bufferSize == 0) {
            bufferSize = 258;
        } else if (bufferSize > 262144) {
            bufferSize = 262144;
        }
        recvBuffer_.resize(bufferSize);
    }

    void Execute() override {
        const SCARD_IO_REQUEST* pioSendPci;
        if (protocol_ == SCARD_PROTOCOL_T0) {
            pioSendPci = SCARD_PCI_T0;
        } else if (protocol_ == SCARD_PROTOCOL_T1) {
            pioSendPci = SCARD_PCI_T1;
        } else {
            pioSendPci = SCARD_PCI_RAW;
        }

        recvLength_ = static_cast<DWORD>(recvBuffer_.size());

        result_ = SCardTransmit(
            card_,
            pioSendPci,
            sendBuffer_.data(),
            static_cast<DWORD>(sendBuffer_.size()),
            nullptr,
            recvBuffer_.data(),
            &recvLength_
        );
    }

    void OnOK() override {
        Napi::Env env = Env();
        if (result_ == SCARD_S_SUCCESS) {
            deferred_.Resolve(Napi::Buffer<uint8_t>::Copy(env, recvBuffer_.data(), recvLength_));
        } else {
            deferred_.Reject(Napi::Error::New(env, GetPCSCErrorString(result_)).Value());
        }
    }

    void OnError(const Napi::Error& error) override {
        deferred_.Reject(error.Value());
    }

private:
    SCARDHANDLE card_;
    DWORD protocol_;
    std::vector<uint8_t> sendBuffer_;
    std::vector<uint8_t> recvBuffer_;
    DWORD recvLength_;
    LONG result_;
    Napi::Promise::Deferred deferred_;
};

class ControlWorker : public Napi::AsyncWorker {
public:
    ControlWorker(Napi::Env env,
                  SCARDHANDLE card,
                  DWORD controlCode,
                  std::vector<uint8_t> sendBuffer,
                  Napi::Promise::Deferred deferred)
        : Napi::AsyncWorker(env),
          card_(card),
          controlCode_(controlCode),
          sendBuffer_(std::move(sendBuffer)),
          bytesReturned_(0),
          result_(SCARD_S_SUCCESS),
          deferred_(deferred) {
        recvBuffer_.resize(256);
    }

    void Execute() override {
        result_ = SCardControl(
            card_,
            controlCode_,
            sendBuffer_.empty() ? nullptr : sendBuffer_.data(),
            static_cast<DWORD>(sendBuffer_.size()),
            recvBuffer_.data(),
            static_cast<DWORD>(recvBuffer_.size()),
            &bytesReturned_
        );
    }

    void OnOK() override {
        Napi::Env env = Env();
        if (result_ == SCARD_S_SUCCESS) {
            deferred_.Resolve(Napi::Buffer<uint8_t>::Copy(env, recvBuffer_.data(), bytesReturned_));
        } else {
            deferred_.Reject(Napi::Error::New(env, GetPCSCErrorString(result_)).Value());
        }
    }

    void OnError(const Napi::Error& error) override {
        deferred_.Reject(error.Value());
    }

private:
    SCARDHANDLE card_;
    DWORD controlCode_;
    std::vector<uint8_t> sendBuffer_;
    std::vector<uint8_t> recvBuffer_;
    DWORD bytesReturned_;
    LONG result_;
    Napi::Promise::Deferred deferred_;
};

class ReconnectWorker : public Napi::AsyncWorker {
public:
    ReconnectWorker(Napi::Env env,
                    SCARDHANDLE card,
                    DWORD shareMode,
                    DWORD preferredProtocols,
                    DWORD initialization,
                    DWORD* protocolOut,
                    Napi::Promise::Deferred deferred)
        : Napi::AsyncWorker(env),
          card_(card),
          shareMode_(shareMode),
          preferredProtocols_(preferredProtocols),
          initialization_(initialization),
          activeProtocol_(0),
          protocolOut_(protocolOut),
          result_(SCARD_S_SUCCESS),
          deferred_(deferred) {}

    void Execute() override {
        result_ = SCardReconnect(
            card_,
            shareMode_,
            preferredProtocols_,
            initialization_,
            &activeProtocol_
        );
    }

    void OnOK() override {
        Napi::Env env = Env();
        if (result_ == SCARD_S_SUCCESS) {
            if (protocolOut_) {
                *protocolOut_ = activeProtocol_;
            }
            deferred_.Resolve(env.Undefined());
        } else {
            deferred_.Reject(Napi::Error::New(env, GetPCSCErrorString(result_)).Value());
        }
    }

    void OnError(const Napi::Error& error) override {
        deferred_.Reject(error.Value());
    }

private:
    SCARDHANDLE card_;
    DWORD shareMode_;
    DWORD preferredProtocols_;
    DWORD initialization_;
    DWORD activeProtocol_;
    DWORD* protocolOut_;
    LONG result_;
    Napi::Promise::Deferred deferred_;
};

// ============================================================================
// PCSCReader
// ============================================================================

Napi::Object PCSCReader::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "Reader", {
        InstanceAccessor("name", &PCSCReader::GetName, nullptr),
        InstanceAccessor("protocol", &PCSCReader::GetProtocolValue, nullptr),
        InstanceAccessor("connected", &PCSCReader::GetConnectedValue, nullptr),
        InstanceAccessor("atr", &PCSCReader::GetAtr, nullptr),
        InstanceMethod("connect", &PCSCReader::Connect),
        InstanceMethod("transmit", &PCSCReader::Transmit),
        InstanceMethod("control", &PCSCReader::Control),
        InstanceMethod("disconnect", &PCSCReader::Disconnect),
        InstanceMethod("reconnect", &PCSCReader::Reconnect),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("Reader", func);
    return exports;
}

Napi::Object PCSCReader::NewInstance(Napi::Env env, SCARDCONTEXT context,
                                    const std::string& readerName) {
    Napi::Object obj = constructor.New({});
    PCSCReader* readerObj = Napi::ObjectWrap<PCSCReader>::Unwrap(obj);
    readerObj->context_ = context;
    readerObj->readerName_ = readerName;
    return obj;
}

PCSCReader::PCSCReader(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<PCSCReader>(info),
      context_(0),
      card_(0),
      protocol_(SCARD_PROTOCOL_UNDEFINED),
      connected_(false) {
    // Properties set via NewInstance
}

PCSCReader::~PCSCReader() {
    if (connected_ && card_ != 0) {
        SCardDisconnect(card_, SCARD_LEAVE_CARD);
        connected_ = false;
        card_ = 0;
    }
}

Napi::Value PCSCReader::GetName(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), readerName_);
}

Napi::Value PCSCReader::GetProtocolValue(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), protocol_);
}

Napi::Value PCSCReader::GetConnectedValue(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), connected_);
}

Napi::Value PCSCReader::GetAtr(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!connected_) {
        return env.Null();
    }

    DWORD readerLen = 0;
    DWORD state = 0;
    DWORD protocol = 0;
    BYTE atr[MAX_ATR_SIZE];
    DWORD atrLen = sizeof(atr);

    LONG result = SCardStatus(card_, nullptr, &readerLen, &state, &protocol, atr, &atrLen);

    if (result != SCARD_S_SUCCESS) {
        return env.Null();
    }

    return Napi::Buffer<uint8_t>::Copy(env, atr, atrLen);
}

Napi::Value PCSCReader::Connect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (connected_) {
        Napi::Error::New(env, "Already connected").ThrowAsJavaScriptException();
        return env.Null();
    }

    DWORD shareMode = SCARD_SHARE_SHARED;
    DWORD preferredProtocols = SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1;

    if (info.Length() > 0 && info[0].IsNumber()) {
        shareMode = info[0].As<Napi::Number>().Uint32Value();
    }

    if (info.Length() > 1 && info[1].IsNumber()) {
        preferredProtocols = info[1].As<Napi::Number>().Uint32Value();
    }

    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    ConnectWorker* worker = new ConnectWorker(
        env, this, shareMode, preferredProtocols, deferred);
    worker->Queue();

    return deferred.Promise();
}

Napi::Value PCSCReader::Transmit(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!connected_) {
        Napi::Error::New(env, "Card is not connected").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected command buffer").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::vector<uint8_t> sendBuffer;

    if (info[0].IsBuffer()) {
        Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
        sendBuffer.assign(buffer.Data(), buffer.Data() + buffer.Length());
    } else if (info[0].IsArray()) {
        Napi::Array arr = info[0].As<Napi::Array>();
        sendBuffer.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); i++) {
            sendBuffer.push_back(static_cast<uint8_t>(arr.Get(i).As<Napi::Number>().Uint32Value()));
        }
    } else {
        Napi::TypeError::New(env, "Expected Buffer or Array").ThrowAsJavaScriptException();
        return env.Null();
    }

    size_t maxRecvLength = 0;
    if (info.Length() > 1 && info[1].IsObject()) {
        Napi::Object options = info[1].As<Napi::Object>();
        if (options.Has("maxRecvLength") && options.Get("maxRecvLength").IsNumber()) {
            maxRecvLength = options.Get("maxRecvLength").As<Napi::Number>().Uint32Value();
        }
    }

    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    TransmitWorker* worker = new TransmitWorker(
        env, card_, protocol_, sendBuffer, maxRecvLength, deferred);
    worker->Queue();

    return deferred.Promise();
}

Napi::Value PCSCReader::Control(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!connected_) {
        Napi::Error::New(env, "Card is not connected").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected control code").ThrowAsJavaScriptException();
        return env.Null();
    }

    DWORD controlCode = info[0].As<Napi::Number>().Uint32Value();

    std::vector<uint8_t> sendBuffer;
    if (info.Length() > 1) {
        if (info[1].IsBuffer()) {
            Napi::Buffer<uint8_t> buffer = info[1].As<Napi::Buffer<uint8_t>>();
            sendBuffer.assign(buffer.Data(), buffer.Data() + buffer.Length());
        } else if (info[1].IsArray()) {
            Napi::Array arr = info[1].As<Napi::Array>();
            sendBuffer.reserve(arr.Length());
            for (uint32_t i = 0; i < arr.Length(); i++) {
                sendBuffer.push_back(static_cast<uint8_t>(arr.Get(i).As<Napi::Number>().Uint32Value()));
            }
        }
    }

    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    ControlWorker* worker = new ControlWorker(
        env, card_, controlCode, sendBuffer, deferred);
    worker->Queue();

    return deferred.Promise();
}

Napi::Value PCSCReader::Disconnect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!connected_) {
        return env.Undefined();
    }

    DWORD disposition = SCARD_LEAVE_CARD;
    if (info.Length() > 0 && info[0].IsNumber()) {
        disposition = info[0].As<Napi::Number>().Uint32Value();
    }

    LONG result = SCardDisconnect(card_, disposition);
    connected_ = false;
    card_ = 0;

    if (result != SCARD_S_SUCCESS) {
        Napi::Error::New(env, GetPCSCErrorString(result)).ThrowAsJavaScriptException();
    }

    return env.Undefined();
}

Napi::Value PCSCReader::Reconnect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!connected_) {
        Napi::Error::New(env, "Card is not connected").ThrowAsJavaScriptException();
        return env.Null();
    }

    DWORD shareMode = SCARD_SHARE_SHARED;
    DWORD preferredProtocols = SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1;
    DWORD initialization = SCARD_LEAVE_CARD;

    if (info.Length() > 0 && info[0].IsNumber()) {
        shareMode = info[0].As<Napi::Number>().Uint32Value();
    }
    if (info.Length() > 1 && info[1].IsNumber()) {
        preferredProtocols = info[1].As<Napi::Number>().Uint32Value();
    }
    if (info.Length() > 2 && info[2].IsNumber()) {
        initialization = info[2].As<Napi::Number>().Uint32Value();
    }

    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    ReconnectWorker* worker = new ReconnectWorker(
        env, card_, shareMode, preferredProtocols, initialization, &protocol_, deferred);
    worker->Queue();

    return deferred.Promise();
}
