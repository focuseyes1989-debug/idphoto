use serde::Deserialize;
#[derive(Clone, Deserialize)]
#[serde(default)]
pub struct Tone {
    pub brushes:Vec<crate::brush::Stroke>,
    pub retouch: f64,
    pub black: f64,
    pub white: f64,
    pub gamma: f64,
    pub output_black: f64,
    pub output_white: f64,
    pub curve: [f64; 5],
    pub selective: Option<crate::selective_color::SelectiveColor>,
    pub points: Option<Vec<[f64;2]>>,
    pub channels: std::collections::HashMap<String,Tone>,
}
impl Default for Tone {
    fn default() -> Self {
        Self {
            brushes:Vec::new(),
            retouch: 0.0,
            black: 0.0,
            white: 255.0,
            gamma: 1.0,
            output_black: 0.0,
            output_white: 255.0,
            curve: [0.0, 64.0, 128.0, 192.0, 255.0],
            selective: None, points: None, channels: Default::default(),
        }
    }
}
impl Tone {
    pub fn lut(&self) -> Result<[u8; 256], String> {
        let t = self;
        crate::brush::validate(&t.brushes)?;
        if !t.retouch.is_finite()||!(0.0..=100.0).contains(&t.retouch){return Err("Invalid retouch strength".into());}
        if ![t.black, t.white, t.gamma, t.output_black, t.output_white]
            .into_iter()
            .chain(t.curve)
            .all(f64::is_finite)
            || t.black < 0.0
            || t.white > 255.0
            || t.black >= t.white
            || !(0.1..=5.0).contains(&t.gamma)
            || t.output_black < 0.0
            || t.output_white > 255.0
            || t.output_black >= t.output_white
            || t.curve.iter().any(|v| !(0.0..=255.0).contains(v))
        {
            return Err("Invalid Levels or Curves adjustment".into());
        }
        let points = t.points.clone().unwrap_or_else(|| [0.0,64.0,128.0,192.0,255.0].into_iter().zip(t.curve).map(|(x,y)|[x,y]).collect());
        if points.len()<2 || points.len()>16 || points[0][0]!=0.0 || points.last().unwrap()[0]!=255.0 || points.iter().any(|p|p.iter().any(|v|!v.is_finite() || !(0.0..=255.0).contains(v))) || points.windows(2).any(|p|p[0][0]>=p[1][0]) {return Err("Invalid curve points".into());}
        let x:Vec<f64> = points.iter().map(|p|p[0]).collect();
        let y:Vec<f64> = points.iter().map(|p|p[1]).collect();
        let n=x.len(); let mut z=vec![0.0;n]; let mut u=vec![0.0;n];
        for i in 1..n-1 {
            let span = x[i + 1] - x[i - 1];
            let sig = (x[i] - x[i - 1]) / span;
            let p = sig * z[i - 1] + 2.0;
            z[i] = (sig - 1.0) / p;
            u[i] = (6.0
                * ((y[i + 1] - y[i]) / (x[i + 1] - x[i]) - (y[i] - y[i - 1]) / (x[i] - x[i - 1]))
                / span
                - sig * u[i - 1])
                / p;
        }
        for i in (0..n-1).rev() {
            z[i] = z[i] * z[i + 1] + u[i];
        }
        Ok(std::array::from_fn(|v| {
            let level = t.output_black
                + ((v as f64 - t.black) / (t.white - t.black))
                    .clamp(0.0, 1.0)
                    .powf(1.0 / t.gamma)
                    * (t.output_white - t.output_black);
            let mut i = 0;
            while i < n-2 && level > x[i + 1] {
                i += 1;
            }
            let h = x[i + 1] - x[i];
            let a = (x[i + 1] - level) / h;
            let b = (level - x[i]) / h;
            (a * y[i]
                + b * y[i + 1]
                + ((a * a * a - a) * z[i] + (b * b * b - b) * z[i + 1]) * h * h / 6.0)
                .clamp(0.0, 255.0)
                .round() as u8
        }))
    }
    pub fn apply(&self, image: image::DynamicImage) -> Result<image::DynamicImage, String> {
        if let Some(s)=&self.selective{s.validate()?;}
        let selective=self.selective.as_ref().filter(|s|s.active());
        let master = self.lut()?;
        let mut luts = [master;3];
        for (i,name) in ["red","green","blue"].iter().enumerate() {if let Some(channel)=self.channels.get(*name) {let lut=channel.lut()?; luts[i]=std::array::from_fn(|v|lut[master[v] as usize]);}}
        let lut=&luts;
        if self.retouch==0.0 && selective.is_none() && lut.iter().all(|l|l.iter().enumerate().all(|(i,v)|i==*v as usize)) {
            return Ok(image);
        }
        let mut rgba = image.to_rgba8();
        crate::retouch::apply(&mut rgba,self.retouch)?;
        for pixel in rgba.pixels_mut() {
            for c in 0..3 {
                pixel[c] = lut[c][pixel[c] as usize];
            }
            if let Some(s)=selective {let rgb=s.pixel([pixel[0],pixel[1],pixel[2]]);pixel[0]=rgb[0];pixel[1]=rgb[1];pixel[2]=rgb[2];}
        }
        Ok(image::DynamicImage::ImageRgba8(rgba))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn free_points_and_channels() {
        let mut t=Tone {points:Some(vec![[0.0,0.0],[100.0,160.0],[255.0,255.0]]),..Default::default()};
        t.channels.insert("red".into(),Tone {output_white:128.0,..Default::default()});
        let input=image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(1,1,image::Rgba([100,100,100,99])));
        assert_eq!(t.apply(input).unwrap().to_rgba8().get_pixel(0,0).0,[80,160,160,99]);
        t.points=Some(vec![[0.0,0.0],[100.0,60.0],[100.0,80.0],[255.0,255.0]]);
        assert!(t.lut().is_err());
    }
    #[test]
    fn identity_and_levels() {
        let t = Tone::default();
        assert_eq!(t.lut().unwrap(), std::array::from_fn(|i| i as u8));
        let t = Tone {
            black: 20.0,
            white: 220.0,
            gamma: 2.0,
            ..Default::default()
        };
        let l = t.lut().unwrap();
        assert_eq!(l[20], 0);
        assert_eq!(l[220], 255);
        assert_eq!(l[120], 180);
    }
    #[test]
    fn curves_preserve_alpha_and_reject_invalid_levels() {
        let t = Tone {
            curve: [0.0, 40.0, 150.0, 220.0, 255.0],
            ..Default::default()
        };
        let l = t.lut().unwrap();
        assert_eq!(l[64], 40);
        assert_eq!(l[128], 150);
        let input = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            1,
            1,
            image::Rgba([64, 128, 192, 37]),
        ));
        assert_eq!(
            t.apply(input).unwrap().to_rgba8().get_pixel(0, 0).0,
            [40, 150, 220, 37]
        );
        assert!(Tone {
            black: 255.0,
            ..Default::default()
        }
        .lut()
        .is_err());
    }
}
