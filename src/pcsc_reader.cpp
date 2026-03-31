#include "pcsc_reader.h"
#include "pcsc_errors.h"
#include "async_workers.h"
#include <cstring>

Napi::FunctionReference PCSCReader::constructor;

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
        env, context_, readerName_, shareMode, preferredProtocols,
        &card_, &protocol_, &connected_, deferred);
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
