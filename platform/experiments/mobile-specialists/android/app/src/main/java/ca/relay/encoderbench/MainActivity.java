package ca.relay.encoderbench;
import android.app.Activity;
import android.os.Bundle;
import android.os.Debug;
import android.widget.TextView;
import android.util.Log;
import ai.onnxruntime.*;
import java.nio.*;
import java.io.*;
import java.util.*;
import org.json.*;
public class MainActivity extends Activity {
  private TextView text;
  @Override public void onCreate(Bundle saved) {
    super.onCreate(saved); text=new TextView(this);text.setTextSize(18);text.setPadding(36,70,36,36);text.setText("Relay local encoder research\n\nRunning native inference...\nThis is a feature extractor, not a damage decision.");setContentView(text);
    new Thread(()->{try{runBenchmark();}catch(Exception e){Log.e("RELAY_BENCH","failed",e);runOnUiThread(()->text.setText(e.toString()));}}).start();
  }
  private byte[] readAsset(String name)throws Exception {try(InputStream in=getAssets().open(name);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buffer=new byte[32768];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);return out.toByteArray();}}
  private void runBenchmark()throws Exception {
    long begin=System.nanoTime();
    OrtEnvironment env=OrtEnvironment.getEnvironment();
    OrtSession.SessionOptions options=new OrtSession.SessionOptions();options.setIntraOpNumThreads(2);options.setInterOpNumThreads(1);options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
    boolean half="fp16".equals(getIntent().getStringExtra("model"));String modelId=half?"precision-fp16":"precision-float";byte[] weights=readAsset(half?"shared-encoder-fp16.onnx":"shared-encoder.onnx");OrtSession session=env.createSession(weights,options);
    byte[] headWeights=readAsset("jacket-routing-head.onnx"); OrtSession head=env.createSession(headWeights,options);
    double loadMs=(System.nanoTime()-begin)/1e6;
    // Identical preprocessed RGB bytes are used for desktop/native numerical parity.
    byte[] bytes=readAsset("input.f32");FloatBuffer floats=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer();
    OnnxTensor input=OnnxTensor.createTensor(env,floats,new long[]{1,3,224,224});
    ArrayList<Double> times=new ArrayList<>();float[] embedding=null;float[] logits=null;
    for(int i=-3;i<30;i++){long start=System.nanoTime();try(OrtSession.Result result=session.run(Collections.singletonMap("rgb",input))){float[] features=((float[][])result.get(0).getValue())[0];if(i==0)embedding=features.clone();try(OnnxTensor featuresTensor=OnnxTensor.createTensor(env,FloatBuffer.wrap(features),new long[]{1,576});OrtSession.Result routed=head.run(Collections.singletonMap("embedding",featuresTensor))){if(i==0)logits=((float[][])routed.get(0).getValue())[0].clone();}}double elapsed=(System.nanoTime()-start)/1e6;if(i>=0)times.add(elapsed);}
    Collections.sort(times);JSONArray values=new JSONArray();for(float v:embedding)values.put((double)v);
    JSONObject report=new JSONObject();report.put("modelId",modelId);report.put("runtime",env.getVersion());report.put("hardware",android.os.Build.MODEL);report.put("abi",android.os.Build.SUPPORTED_ABIS[0]);report.put("sdk",android.os.Build.VERSION.SDK_INT);report.put("networkPermission",false);report.put("modelBytes",weights.length);report.put("headBytes",headWeights.length);report.put("routingLogits",new JSONArray(Arrays.toString(logits)));report.put("loadMs",loadMs);report.put("runs",30);report.put("warmups",3);report.put("p50Ms",times.get(15));report.put("p95Ms",times.get(28));report.put("minMs",times.get(0));report.put("maxMs",times.get(29));report.put("nativeHeapBytes",Debug.getNativeHeapAllocatedSize());report.put("embedding",values);report.put("boundary","Android emulator CPU measurement. Preprocessing excluded. Shared encoder plus research-only trained routing head. The routing head fails a diagnostic image and is not activated. Not a damage specialist or physical-phone benchmark.");
    try(FileOutputStream out=new FileOutputStream(new File(getExternalFilesDir(null),modelId+"-benchmark.json"))){out.write(report.toString(2).getBytes("UTF-8"));}
    Log.i("RELAY_BENCH",report.toString());runOnUiThread(()->text.setText("Relay · local encoder research\n\nModel: "+weights.length+" bytes\n30 native inference runs\nMedian: "+times.get(15)+" ms\np95: "+times.get(28)+" ms\n\nNo network permission.\nFeature extractor only; no damage prediction.\n\nThis is an emulator measurement, not a physical-phone benchmark."));
    input.close();head.close();session.close();options.close();
  }
}
